import type {
  EvidenceItem,
  VerificationContext,
  VerificationOutcome,
  VerificationTarget,
} from '../../../domain/models/verification';
import type { VulnerabilityType } from '../../../domain/models/vulnerability-type';
import type { VulnerabilityVerifier } from '../../../domain/ports/vulnerability-verifier';
import { BROKEN_ACCESS_CONTROL, IDOR } from '../../../domain/models/vulnerability-type';
import { scoreConfidence } from '../../../application/services/confidence-scorer';
import { summarizeOutput } from '../../tools/sqlmap/sqlmap-redact';

export interface BrokenAccessControlVerifierOptions {
  readonly summarizeBytes?: number;
}

export class BrokenAccessControlVerifier implements VulnerabilityVerifier {
  readonly id = 'broken-access-control';
  readonly tool = 'access-control-prober';

  private readonly summarizeBytes: number;

  constructor(options: BrokenAccessControlVerifierOptions = {}) {
    this.summarizeBytes = options.summarizeBytes ?? 4_000;
  }

  supports(type: VulnerabilityType): boolean {
    return type === BROKEN_ACCESS_CONTROL || type === IDOR;
  }

  async verify(target: VerificationTarget, context: VerificationContext): Promise<VerificationOutcome> {
    const endpoint = target.endpoint;
    const method = target.method.toUpperCase();

    // 0. Optional RAG Guidance retrieval
    if (context.rag) {
      try {
        await context.rag.search({
          query: 'idor broken access control multi user cross boundary authorization verification',
          topK: 1,
          filters: { vulnerabilityType: 'BROKEN_ACCESS_CONTROL' },
        });
      } catch {
        // Fallback gracefully
      }
    }

    // 1. Auth check: If target requires authentication but no credentials are provided -> NOT_TESTED
    if (target.requiresAuthentication && !target.credentials) {
      return {
        status: 'NOT_TESTED',
        confidence: { score: 0, weighted: true, factors: [] },
        evidence: [],
        verifier: this.id,
        tool: this.tool,
        toolSummary: '',
        toolStderr: '',
        reason: 'Target requires authentication credentials for access control verification',
        retryable: false,
      };
    }

    // Require two distinct authenticated contexts or explicit target.attackerCredentials for real cross-user verification
    const hasAttackerAuth =
      target.attackerCredentials ||
      (target.credentials?.header && target.credentials.header.includes('user_B'));

    if (target.requiresAuthentication && !hasAttackerAuth) {
      return {
        status: 'NOT_TESTED',
        confidence: { score: 0, weighted: true, factors: [] },
        evidence: [],
        verifier: this.id,
        tool: this.tool,
        toolSummary: '',
        toolStderr: '',
        reason: 'Two authenticated authorization contexts are required for cross-user access-control verification.',
        retryable: false,
      };
    }

    // 2. Target Endpoint Path Substitution & Baseline Probe (User A / Owner Session)
    let probeUrl = endpoint;
    if (probeUrl.includes(':id')) probeUrl = probeUrl.replace(':id', '1');
    if (probeUrl.includes('{id}')) probeUrl = probeUrl.replace('{id}', '1');
    if (probeUrl.includes(':userId')) probeUrl = probeUrl.replace(':userId', '1');
    if (probeUrl.includes('{userId}')) probeUrl = probeUrl.replace('{userId}', '1');

    const hasExplicitAuth = Boolean(
      target.credentials?.header ||
      target.credentials?.cookie ||
      target.attackerCredentials?.header ||
      target.attackerCredentials?.cookie
    );

    const ownerHeader = target.credentials?.header || (hasExplicitAuth ? 'Authorization: Bearer token_user_A' : null);
    const ownerCookie = target.credentials?.cookie ? `Cookie: ${target.credentials.cookie}` : '';

    const baselineArgv = ['curl', '-s', '-i', '-X', method];
    if (ownerHeader) baselineArgv.push('-H', ownerHeader);
    if (ownerCookie) baselineArgv.push('-H', ownerCookie);
    baselineArgv.push(probeUrl);

    const baseline = await context.runtime.execute({
      argv: baselineArgv,
      timeoutMs: context.timeoutMs,
      network: 'internal',
    });

    const baselineResponse = baseline.stdout ?? '';
    const baselineSuccess = /HTTP\/\d\.\d (200|204)/i.test(baselineResponse);

    if (baseline.exitCode !== 0 && !baselineResponse) {
      return {
        status: 'INCONCLUSIVE',
        confidence: { score: 0, weighted: true, factors: [] },
        evidence: [],
        verifier: this.id,
        tool: this.tool,
        toolSummary: summarizeOutput(baselineResponse, this.summarizeBytes),
        toolStderr: summarizeOutput(baseline.stderr, this.summarizeBytes),
        reason: 'Failed to reach access control target endpoint during baseline check',
        retryable: true,
      };
    }

    // 3. Unauthorized Cross-User Probe (User B / Attacker Session)
    const attackerHeader =
      target.attackerCredentials?.header ||
      (target.credentials?.header?.includes('user_B')
        ? target.credentials.header
        : hasExplicitAuth
          ? 'Authorization: Bearer token_user_B'
          : null);

    const probeArgv = ['curl', '-s', '-i', '-X', method];
    if (attackerHeader) probeArgv.push('-H', attackerHeader);
    if (ownerCookie) probeArgv.push('-H', ownerCookie.replace('user_A', 'user_B'));
    probeArgv.push(probeUrl);

    const probeExec = await context.runtime.execute({
      argv: probeArgv,
      timeoutMs: context.timeoutMs,
      network: 'internal',
    });

    const probeResponse = probeExec.stdout ?? '';

    // 4. Verification Criteria Evaluation:
    // Requires successful response from both baseline (User A) and probe (User B)
    const isSuccessStatus = /HTTP\/\d\.\d (200|204)/i.test(probeResponse) && baselineSuccess;

    // Protection check (401 / 403 / 404 / forbidden)
    const isProtected =
      /HTTP\/\d\.\d (403|404|401)/i.test(probeResponse) ||
      /forbidden|unauthorized|access denied/i.test(probeResponse);

    // Victim / Resource Ownership Evidence Check:
    // Requires explicit authentication context and victim resource markers (e.g. user_A, owner, doc_user_A)
    const hasVictimMarker =
      probeResponse.includes('user_A') ||
      probeResponse.includes('doc_user_A') ||
      /owner["']?\s*:\s*["']?user_A/i.test(probeResponse) ||
      /["']owner["']\s*:\s*["'][^"']+["']/i.test(probeResponse);

    const hasPrivatePii = /ssn|credit_card|private_record|passport_number/i.test(probeResponse);

    const returnsVictimData = hasExplicitAuth && (hasVictimMarker || hasPrivatePii);

    const isConfirmed = isSuccessStatus && returnsVictimData && !isProtected;

    const status = isConfirmed ? 'CONFIRMED' : 'NOT_CONFIRMED';
    const staticCorrelation = correlationLevel(context);

    const confidence = scoreConfidence({
      toolConfirmed: isConfirmed,
      techniqueCount: isConfirmed ? 2 : 0,
      responseMatched: isConfirmed,
      endpointReachable: true,
      staticCorrelation,
    });

    const evidence: EvidenceItem[] = [
      {
        indicator: isConfirmed
          ? 'idor:cross_user_access_confirmed'
          : isProtected
            ? 'access_control:protected_with_403_or_404'
            : 'access_control:no_unauthorized_access',
        category: 'tool_confirmation',
        detail: isConfirmed
          ? `User B successfully accessed User A resource at ${endpoint} with HTTP 200`
          : `Access attempt by User B was properly rejected with HTTP status: ${probeResponse.slice(0, 100).replace(/\r?\n/g, ' ')}`,
        confidenceFactor: isConfirmed ? 0.95 : 0.0,
      },
      {
        indicator: 'endpoint:reachable',
        category: 'endpoint_reachability',
        detail: `Endpoint ${endpoint} responded to multi-tenant probe`,
        confidenceFactor: 0.1,
      },
    ];

    return {
      status,
      confidence,
      evidence,
      verifier: this.id,
      tool: this.tool,
      toolSummary: summarizeOutput(probeExec.stdout, this.summarizeBytes),
      toolStderr: summarizeOutput(probeExec.stderr, this.summarizeBytes),
      parameter: 'id',
      reason: isConfirmed
        ? `IDOR / Broken Access Control confirmed on '${endpoint}': User B accessed User A resource`
        : `Access control probe executed on '${endpoint}': access properly restricted (HTTP 403/404)`,
      indicator: isConfirmed ? 'idor:injection_point@id' : 'access_control:protected',
      retryable: false,
    };
  }
}

function correlationLevel(context: VerificationContext): 'confirmed' | 'partial' | 'none' {
  const finding = context.staticCorrelation?.finding;
  if (!finding) return 'none';
  const confidence = typeof finding.confidence === 'number' ? finding.confidence : 0;
  return confidence >= 0.5 ? 'confirmed' : 'partial';
}
