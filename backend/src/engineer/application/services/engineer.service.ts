/**
 * EngineerService — the Engineer agent orchestrator (application layer).
 *
 * Responsibilities (single run):
 *  1. prepare context (selection → sandbox → source → RAG)   [resolve sym]
 *  2. load prompts via PromptRegistry                         [assembler]
 *  3. call LLMProvider (port only)                           [direct]
 *  4. structurally validate the model response               [validator]
 *  5. run the deterministic security-review gate + persist   [engineer-outcome]
 *
 * NO Docker, NO Qdrant, NO provider SDKs, NO raw Prisma queries appear
 * here — everything flows through existing ports. The model's output is
 * UNTRUSTED: it is validated structurally, gated deterministically, and
 * persisted as a Patch row (status GENERATED | REJECTED). It is never
 * executed and never applied.
 */

import { logger } from '../../../config/logger';
import type { LLMProvider } from '../../../llm/domain/ports/llm-provider';
import type { AgentExecutionService } from '../../../agent/application/services/agent-execution.service';
import type { AgentExecutionDetail } from '../../../agent/application/services/agent-execution.service';
import type { PromptRegistry } from '../../../prompts/domain/prompt-registry';
import type { RagService } from '../../../knowledge/application/services/rag.service';
import type { RuntimeSandboxStore } from '../../../sandbox/domain/ports/runtime-sandbox-store';
import { InvalidEngineerResponseError } from '../../domain/errors/engineer.errors';
import type { EngineerBounds, EngineerResponse } from '../../domain/models/engineer-response';
import { DEFAULT_ENGINEER_BOUNDS } from '../../domain/models/engineer-response';
import type { EngineerFeedback } from '../../domain/models/engineer-feedback';
import type { ConfirmedFindingRepository } from '../../domain/ports/confirmed-finding-repository';
import type { EngineerPatchRepository } from '../../domain/ports/patch-repository';
import type { EngineerSourceReader } from '../../domain/ports/source-reader';
import { assembleEngineerRequest } from './prompt-assembler';
import { validateEngineerResponse } from './response-validator';
import { SecurityReviewGate } from './security-review-gate';
import { prepareEngineerRun, tryParseJsonObject } from './engineer-run-context';
import {
  persistEngineerOutcome,
  recordEngineerExecution,
  recordEngineerFailure,
} from './engineer-outcome';

export type EngineerRunStatus = 'GENERATED' | 'REJECTED' | 'FAILED';

export interface EngineerRunInput {
  readonly scanId: string;
  /** Optional explicit target; omitted → deterministic highest-priority pick. */
  readonly vulnerabilityId?: string;
  /** Optionally pass Critic feedback from a rejected previous attempt. */
  readonly feedback?: EngineerFeedback | null;
}

export interface EngineerRunResult {
  readonly executionId: string;
  readonly vulnerabilityId: string;
  readonly patchId: string | null;
  readonly status: EngineerRunStatus;
  readonly summary: {
    readonly sourceLines: number;
    readonly ragDocs: number;
    readonly reviewPassed: boolean;
    readonly model: string;
    readonly diffChars: number;
    readonly reason: string | null;
  };
}

export interface EngineerDependencies {
  readonly findings: ConfirmedFindingRepository;
  readonly patches: EngineerPatchRepository;
  readonly sourceReader: EngineerSourceReader;
  readonly rag: RagService;
  readonly registry: PromptRegistry;
  readonly llm: LLMProvider;
  readonly executions: AgentExecutionService;
  readonly runtimeStore: RuntimeSandboxStore;
  readonly bounds?: EngineerBounds;
  readonly maxSourceBytes?: number;
  readonly maxContextLines?: number;
  readonly defaultContextWindow?: number;
  readonly ragTopK?: number;
  /** Phase 9 observability publisher (default: silent). */
  readonly events?: import('../../../observability/domain/ports/event-bus').AmassEventPublisher;
}

export interface EngineerService {
  run(input: EngineerRunInput): Promise<EngineerRunResult>;
  getRun(executionId: string): Promise<AgentExecutionDetail | null>;
}

export class DefaultEngineerService implements EngineerService {
  private readonly bounds: EngineerBounds;
  private readonly gate: SecurityReviewGate;

  constructor(private readonly deps: EngineerDependencies) {
    this.bounds = deps.bounds ?? DEFAULT_ENGINEER_BOUNDS;
    this.gate = new SecurityReviewGate(deps.registry);
  }

  async run(input: EngineerRunInput): Promise<EngineerRunResult> {
    const startedAt = new Date();
    const scanId = input.scanId;
    let targetVulnerabilityId: string | null = input.vulnerabilityId ?? null;

    try {
      this.emit(scanId, {
        eventType: 'ENGINEER_STARTED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        status: 'STARTED',
        message: `engineer drafting patch for ${targetVulnerabilityId ?? 'finding'}`,
        metadata: { vulnerabilityId: targetVulnerabilityId ?? undefined },
      });
      const prepared = await prepareEngineerRun(this.deps, input);
      targetVulnerabilityId = prepared.finding.vulnerabilityId;
      this.emit(scanId, {
        eventType: 'ENGINEER_SOURCE_READ',
        agentType: 'ENGINEER',
        phase: 'remediation',
        status: 'SUCCEEDED',
        message: `read source ${prepared.finding.filePath} (${prepared.source.lines.length} lines)`,
        metadata: { filePath: prepared.finding.filePath ?? undefined, lineStart: prepared.source.offset, lineEnd: prepared.source.offset + prepared.source.lines.length - 1, counts: { sourceLines: prepared.source.lines.length } },
      });

      const assembly = await assembleEngineerRequest(this.deps.registry, {
        finding: prepared.finding,
        repository: { name: undefined, url: undefined, primaryLanguage: null },
        source: prepared.source,
        ragAdvisory: prepared.rag.advisory,
        ragDocsUsed: prepared.rag.docs.length,
        feedback: input.feedback ?? null,
      });

      this.emit(scanId, {
        eventType: 'ENGINEER_LLM_STARTED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        status: 'STARTED',
        message: 'requesting patch from the LLM',
      });
      const llmResponse = await this.deps.llm.generate({
        messages: assembly.messages,
        temperature: 0.2,
        maxTokens: 2_000,
        responseFormat: 'json_object',
      });
      this.emit(scanId, {
        eventType: 'ENGINEER_LLM_COMPLETED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        status: 'COMPLETED',
        message: `LLM responded (${llmResponse.model})`,
        metadata: { source: llmResponse.model },
      });

      const raw = tryParseJsonObject(llmResponse.text);
      const validated = validateEngineerResponse(
        raw,
        { vulnerabilityId: prepared.finding.vulnerabilityId, filePath: prepared.finding.filePath },
        this.bounds,
      );
      if (!validated.ok) {
        throw new InvalidEngineerResponseError('model response failed structural validation', {
          failures: validated.failures,
          model: llmResponse.model,
        });
      }
      const response: EngineerResponse = validated.response;

      const outcome = await persistEngineerOutcome(this.deps, this.gate, {
        response,
        finding: prepared.finding,
        sourceLines: prepared.source.lines.length,
        ragDocs: prepared.rag.docs.length,
      });

      const execution = await recordEngineerExecution(this.deps, {
        scanId,
        finding: prepared.finding,
        loom: outcome.status,
        model: llmResponse.model,
        outcome,
        ragDocs: prepared.rag.docs.length,
        startedAt: startedAt.toISOString(),
      });

      this.emit(scanId, {
        eventType: outcome.patch ? 'ENGINEER_PATCH_GENERATED' : 'ENGINEER_REJECTED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        status: outcome.patch ? 'SUCCEEDED' : 'REJECTED',
        message: outcome.patch ? `patch generated: ${outcome.patch.id}` : 'no patch generated',
        metadata: { vulnerabilityId: prepared.finding.vulnerabilityId, patchId: outcome.patch?.id ?? undefined, result: outcome.status, counts: { ragDocs: prepared.rag.docs.length } },
      });

      return {
        executionId: execution.id,
        vulnerabilityId: prepared.finding.vulnerabilityId,
        patchId: outcome.patch ? outcome.patch.id : null,
        status: outcome.status,
        summary: {
          sourceLines: prepared.source.lines.length,
          ragDocs: prepared.rag.docs.length,
          reviewPassed: outcome.reviewPassed,
          model: llmResponse.model,
          diffChars: outcome.diffChars,
          reason: outcome.reason,
        },
      };
    } catch (error) {
      this.emit(scanId, {
        eventType: 'ENGINEER_FAILED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        level: 'ERROR',
        status: 'FAILED',
        message: 'engineer run failed',
        metadata: { vulnerabilityId: targetVulnerabilityId ?? undefined, error: error instanceof Error ? error.message.slice(0, 160) : undefined },
      });
      await recordEngineerFailure(this.deps, scanId, targetVulnerabilityId, startedAt, error);
      throw error;
    }
  }

  private emit(scanId: string, input: Omit<import('../../../observability/domain/ports/event-bus').AmassEventInput, 'scanId'>): void {
    if (!this.deps.events) return;
    try {
      this.deps.events.publish({ ...input, scanId });
    } catch (err) {
      logger.warn({ err }, 'engineer.events: publish ignored');
    }
  }

  async getRun(executionId: string): Promise<AgentExecutionDetail | null> {
    return this.deps.executions.find(executionId);
  }
}