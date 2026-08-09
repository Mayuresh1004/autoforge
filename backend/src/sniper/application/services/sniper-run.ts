/**
 * Per-target verification pipeline for the Sniper Agent: validates and
 * executes ONE planned target — same-origin, scan-scoped, supported type,
 * auth-with-explicit-credentials — runs the bounded AttemptLoop, and
 * persists the final Exploit separately from per-attempt records.
 *
 * All execution stays inside the sandbox: the `runtime` is bound to a
 * sandbox id and routed through the SandboxManager by the caller. A failing
 * target never crashes a run — it becomes a refusal record.
 */
import { logger } from '../../../config/logger';
import type { SniperConfig } from '../../../config';
import type {
  CorrelatedFinding,
  ConfidenceBreakdown,
  EvidenceItem,
  ProofOfConcept,
  VerificationContext,
  VerificationStatus,
  VerificationTarget,
} from '../../domain/models/verification';
import type { VulnerabilityType } from '../../domain/models/vulnerability-type';
import { resolveVulnerabilityType } from '../../domain/models/vulnerability-type';
import type { ToolRuntime } from '../../domain/ports/tool-runtime';
import type { PlannedTargetSnapshot, SniperRepository } from '../../domain/ports/sniper-repository';
import type { VerifierRegistry } from '../../domain/ports/vulnerability-verifier';
import type { RunSniperInput, TargetRunOutcome } from '../../domain/ports/sniper-service';
import {
  AuthenticationUnavailableError,
  CrossOriginTargetError,
  SandboxMismatchError,
  TargetNotFoundError,
  UnsupportedVulnerabilityTypeError,
} from '../../domain/errors/sniper.errors';
import { resolveSameOriginEndpoint } from './target-origin';
import { AttemptLoop, messageOf } from './attempt-loop';
import type { AmassEventPublisher, AmassEventInput } from '../../../observability/domain/ports/event-bus';

export interface SniperRunDeps {
  readonly repository: SniperRepository;
  readonly verifiers: VerifierRegistry;
  readonly config: SniperConfig;
  /** Phase 9 observability publisher (optional). */
  readonly events?: AmassEventPublisher;
}

export class SniperTargetRunner {
  private readonly attemptLoop: AttemptLoop;

  constructor(private readonly deps: SniperRunDeps) {
    this.attemptLoop = new AttemptLoop(deps.repository, deps.config);
  }

  private emit(scanId: string, event: Omit<AmassEventInput, 'scanId'>): void {
    if (!this.deps.events) return;
    try {
      this.deps.events.publish({ ...event, scanId });
    } catch (error) {
      logger.warn({ err: error }, 'sniper-run.events: publish ignored');
    }
  }

  async runTarget(
    input: RunSniperInput,
    targetId: string,
    findings: readonly CorrelatedFinding[],
    runtime: ToolRuntime
  ): Promise<TargetRunOutcome> {
    const startedAt = new Date();
    const persist = input.options?.persist !== false;
    let planned: PlannedTargetSnapshot | null = null;
    try {
      // 1-2. Planned target exists and is scoped to this scan/sandbox.
      planned = await this.deps.repository.loadPlannedTarget(targetId);
      if (!planned) throw new TargetNotFoundError(targetId);
      if (planned.scanId !== input.scanId) {
        throw new SandboxMismatchError(input.sandboxId, targetId, input.scanId, planned.scanId);
      }

      // 3. Same-origin — never attack outside the sandbox app.
      const { url: resolvedUrl } = resolveSameOriginEndpoint(
        planned.endpoint,
        input.baseUrl
      );

      // 4. First supported candidate vulnerability wins.
      const type = this.pickSupportedType(planned.candidateVulnerabilities);
      if (!type) {
        const label = planned.candidateVulnerabilities[0] ?? 'unknown';
        return this.refusalRecord(input, targetId, startedAt, 'NOT_TESTED', label,
          `unsupported candidate vulnerability (${label})`);
      }

      // 4b. Observability: target selected with the chosen vulnerability type.
      this.emit(input.scanId, {
        eventType: 'SNIPER_TARGET_SELECTED',
        agentType: 'SNIPER',
        phase: 'verification',
        status: 'IN_PROGRESS',
        message: `selected ${targetId} (${type})`,
        metadata: { targetId, endpoint: resolvedUrl, vulnerabilityId: planned.candidateVulnerabilities[0] ?? undefined, check: type },
      });

      // 5. Auth: only explicitly-provided credentials; otherwise NOT_TESTED.
      if (planned.requiresAuthentication && !input.credentials) {
        throw new AuthenticationUnavailableError(targetId);
      }

      // Verifier must exist for the chosen type (future types register here).
      const verifier = this.deps.verifiers.getVerifier(type);
      if (!verifier) {
        throw new UnsupportedVulnerabilityTypeError(targetId, type, 'sql-injection');
      }

      const maxAttempts = Math.max(
        1,
        input.options?.maxAttempts ?? this.deps.config.maxAttempts
      );
      const timeoutMs = Math.max(
        1_000,
        input.options?.timeoutMs ?? this.deps.config.attemptTimeoutMs
      );

      // Reserve the final row (status TESTING) so attempts can attach to it.
      // In non-persist mode (dry-run checks) this is an in-memory placeholder.
      const seed = persist
        ? await this.deps.repository.saveExploit({
            scanId: input.scanId,
            targetId,
            vulnerabilityId: correlateFindingId(findings, type),
            type,
            status: 'TESTING',
            confidence: null,
            confidenceBreakdown: null,
            endpoint: resolvedUrl,
            method: planned.method,
            parameter: null,
            tool: verifier.tool,
            reason: 'verification in progress',
            evidence: [],
            attacks: 0,
            startedAt,
            completedAt: new Date(),
            durationMs: null,
          })
        : inMemoryPoc({
            id: `in-memory:${input.scanId}:${targetId}`,
            scanId: input.scanId,
            targetId,
            vulnerabilityId: correlateFindingId(findings, type),
            type,
            status: 'TESTING',
            confidence: null,
            confidenceBreakdown: null,
            endpoint: resolvedUrl,
            method: planned.method,
            parameter: null,
            verifier: verifier.id,
            tool: verifier.tool,
            reason: 'verification in progress',
            evidence: [],
            attacks: 0,
            startedAt,
            completedAt: new Date(),
            durationMs: null,
          });

      const target: VerificationTarget = {
        targetId,
        endpoint: resolvedUrl,
        method: planned.method,
        type,
        requiresAuthentication: planned.requiresAuthentication,
        credentials: input.credentials,
      };
      const context = buildContext(input, target, runtime, findings, timeoutMs);

      // 6-7. Attempt loop (bounded; retry only transient failures).
      const final = await this.attemptLoop.run({
        input,
        planned,
        type,
        verifier,
        context,
        exploitId: seed.id,
        maxAttempts,
        persist,
      });

      // 8. Record the FINAL exploit status (status + evidence kept separate
      //    from the individual attempts). Dry-run mode returns in memory.
      const poc = persist
        ? await this.deps.repository.saveExploit({
            scanId: input.scanId,
            targetId,
            vulnerabilityId: correlateFindingId(findings, type),
            type,
            status: final.outcome.status,
            confidence: final.outcome.confidence.score,
            confidenceBreakdown: final.outcome.confidence,
            endpoint: resolvedUrl,
            method: planned.method,
            parameter: final.outcome.parameter ?? null,
            tool: final.outcome.tool,
            reason: final.outcome.reason,
            evidence: final.outcome.evidence,
            attacks: final.attempts,
            startedAt,
            completedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
            errorMessage: final.outcome.status === 'FAILED' ? final.outcome.reason : null,
          })
        : inMemoryPoc({
            id: `in-memory:${input.scanId}:${targetId}`,
            scanId: input.scanId,
            targetId,
            vulnerabilityId: correlateFindingId(findings, type),
            type,
            status: final.outcome.status,
            confidence: final.outcome.confidence.score,
            confidenceBreakdown: final.outcome.confidence,
            endpoint: resolvedUrl,
            method: planned.method,
            parameter: final.outcome.parameter ?? null,
            verifier: final.outcome.verifier,
            tool: final.outcome.tool,
            reason: final.outcome.reason,
            evidence: final.outcome.evidence,
            attacks: final.attempts,
            startedAt,
            completedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
          });

      if (final.outcome.status === 'CONFIRMED') {
        this.emit(input.scanId, {
          eventType: 'SNIPER_CONFIRMED',
          agentType: 'SNIPER',
          phase: 'verification',
          status: 'CONFIRMED',
          message: `exploit confirmed for target "${targetId}"`,
          metadata: { targetId, endpoint: resolvedUrl, check: type, result: final.outcome.status, counts: { attempts: final.attempts } },
        });
      } else {
        this.emit(input.scanId, {
          eventType: 'SNIPER_REJECTED',
          agentType: 'SNIPER',
          phase: 'verification',
          status: 'REJECTED',
          message: `target "${targetId}" not exploited (${final.outcome.reason ?? 'no confirmed finding'})`,
          metadata: { targetId, endpoint: resolvedUrl, check: type, result: final.outcome.status, counts: { attempts: final.attempts } },
        });
      }

      logger.info(
        {
          scanId: input.scanId,
          targetId,
          vulnerabilityType: type,
          verifier: verifier.id,
          attempts: final.attempts,
          status: final.outcome.status,
          durationMs: Date.now() - startedAt.getTime(),
        },
        'sniper.target: complete'
      );
      return { targetId, exploit: poc };
    } catch (error) {
      // A validation-stage refusal or unexpected error: persist a clear
      // record and move on — a bad target never kills the whole run.
      logger.warn(
        { scanId: input.scanId, targetId, error },
        'sniper.target: refused'
      );
      const label = planned?.candidateVulnerabilities?.[0] ?? '-';
      return this.refusalRecord(
        input,
        targetId,
        startedAt,
        statusFor(error),
        label,
        messageOf(error)
      );
    }
  }

  private pickSupportedType(candidates: readonly string[]): VulnerabilityType | null {
    for (const label of candidates) {
      const type = resolveVulnerabilityType(label);
      if (type && this.deps.verifiers.supports(type)) return type;
    }
    return null;
  }

  private async refusalRecord(
    input: RunSniperInput,
    targetId: string,
    startedAt: Date,
    status: VerificationStatus,
    typeLabel: string,
    reason: string
  ): Promise<TargetRunOutcome> {
    const persist = input.options?.persist !== false;
    const poc = persist
      ? await this.deps.repository.saveExploit({
          scanId: input.scanId,
          targetId,
          vulnerabilityId: null,
          type: typeLabel as VulnerabilityType,
          status,
          confidence: null,
          confidenceBreakdown: null,
          endpoint: targetId,
          method: 'GET',
          parameter: null,
          tool: null,
          reason,
          evidence: [],
          attacks: 0,
          startedAt,
          completedAt: new Date(),
          durationMs: 0,
        })
      : inMemoryPoc({
          id: `in-memory:${input.scanId}:${targetId}`,
          scanId: input.scanId,
          targetId,
          vulnerabilityId: null,
          type: typeLabel as VulnerabilityType,
          status,
          confidence: null,
          confidenceBreakdown: null,
          endpoint: targetId,
          method: 'GET',
          parameter: null,
          verifier: '-',
          tool: null,
          reason,
          evidence: [],
          attacks: 0,
          startedAt,
          completedAt: new Date(),
          durationMs: 0,
        });
    return { targetId, exploit: poc };
  }
}

// -- helpers ----------------------------------------------------------------

/** In-memory PoC record for dry-run (non-persisting) verification. */
interface InMemoryPocInput {
  readonly id: string;
  readonly scanId: string;
  readonly targetId: string;
  readonly vulnerabilityId: string | null;
  readonly type: VulnerabilityType;
  readonly status: VerificationStatus;
  readonly confidence: number | null;
  readonly confidenceBreakdown: ConfidenceBreakdown | null;
  readonly endpoint: string;
  readonly method: string;
  readonly parameter: string | null;
  readonly verifier: string;
  readonly tool: string | null;
  readonly reason: string;
  readonly evidence: readonly EvidenceItem[];
  readonly attacks: number;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly durationMs: number | null;
}

function inMemoryPoc(parts: InMemoryPocInput): ProofOfConcept {
  return {
    id: parts.id,
    targetId: parts.targetId,
    scanId: parts.scanId,
    vulnerabilityId: parts.vulnerabilityId,
    type: parts.type,
    status: parts.status,
    confidence: parts.confidence,
    confidenceBreakdown: parts.confidenceBreakdown,
    endpoint: parts.endpoint,
    method: parts.method,
    parameter: parts.parameter,
    verifier: parts.verifier,
    tool: parts.tool,
    reason: parts.reason,
    evidence: parts.evidence,
    attacks: parts.attacks,
    startedAt: parts.startedAt.toISOString(),
    completedAt: parts.completedAt.toISOString(),
    durationMs: parts.durationMs,
  };
}

function buildContext(
  input: RunSniperInput,
  target: VerificationTarget,
  runtime: ToolRuntime,
  findings: readonly CorrelatedFinding[],
  timeoutMs: number
): VerificationContext {
  return {
    scanId: input.scanId,
    sandboxId: input.sandboxId,
    baseUrl: input.baseUrl,
    target,
    runtime,
    staticCorrelation: correlationFor(findings, target.type),
    timeoutMs,
  };
}

function correlationFor(
  findings: readonly CorrelatedFinding[],
  type: VulnerabilityType
): { hasFinding: boolean; finding?: CorrelatedFinding } {
  const match = bestFindingFor(findings, type);
  return match ? { hasFinding: true, finding: match } : { hasFinding: false };
}

function bestFindingFor(
  findings: readonly CorrelatedFinding[],
  type: VulnerabilityType
): CorrelatedFinding | null {
  let best: CorrelatedFinding | null = null;
  for (const f of findings) {
    const resolved = f.vulnType ? resolveVulnerabilityType(f.vulnType) : null;
    const cweMatches = /89/.test(f.cwe ?? '');
    if (resolved === type || cweMatches) {
      if (!best || f.confidence > best.confidence) best = f;
    }
  }
  return best;
}

function correlateFindingId(
  findings: readonly CorrelatedFinding[],
  type: VulnerabilityType
): string | null {
  return bestFindingFor(findings, type)?.id ?? null;
}

function statusFor(error: unknown): VerificationStatus {
  return isRefusal(error) ? 'NOT_TESTED' : 'FAILED';
}

function isRefusal(error: unknown): boolean {
  return (
    error instanceof TargetNotFoundError ||
    error instanceof CrossOriginTargetError ||
    error instanceof AuthenticationUnavailableError ||
    error instanceof UnsupportedVulnerabilityTypeError ||
    error instanceof SandboxMismatchError
  );
}