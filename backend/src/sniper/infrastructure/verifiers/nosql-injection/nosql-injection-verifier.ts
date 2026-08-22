import type {
  ConfidenceBreakdown,
  ConfidenceFactorCategory,
  EvidenceItem,
  VerificationContext,
  VerificationOutcome,
  VerificationTarget,
} from '../../../domain/models/verification';
import type { VulnerabilityType } from '../../../domain/models/vulnerability-type';
import type { VulnerabilityVerifier } from '../../../domain/ports/vulnerability-verifier';
import { NOSQL_INJECTION } from '../../../domain/models/vulnerability-type';
import { scoreConfidence } from '../../../application/services/confidence-scorer';
import { summarizeOutput } from '../../tools/sqlmap/sqlmap-redact';

export interface NoSqlInjectionVerifierOptions {
  readonly summarizeBytes?: number;
}

/**
 * NoSQL Injection verifier. Safely probes MongoDB/NoSQL targets using operator-based
 * payload probes ($ne, $gt, etc.) executed via standard HTTP probe calls inside the
 * sandbox container.
 */
export class NoSqlInjectionVerifier implements VulnerabilityVerifier {
  readonly id = 'nosql-injection';
  readonly tool = 'nosql-prober';

  private readonly summarizeBytes: number;

  constructor(options: NoSqlInjectionVerifierOptions = {}) {
    this.summarizeBytes = options.summarizeBytes ?? 4_000;
  }

  supports(type: VulnerabilityType): boolean {
    return type === NOSQL_INJECTION;
  }

  async verify(target: VerificationTarget, context: VerificationContext): Promise<VerificationOutcome> {
    const startedAt = Date.now();
    const endpoint = target.endpoint;
    const method = target.method.toUpperCase();

    // 1. Baseline Request
    const baseline = await context.runtime.execute({
      argv: ['curl', '-s', '-i', '-X', method, endpoint],
      timeoutMs: context.timeoutMs,
      network: 'internal',
    });

    if (baseline.exitCode !== 0 && !baseline.stdout) {
      return {
        status: 'INCONCLUSIVE',
        confidence: { score: 0, weighted: true, factors: [] },
        evidence: [],
        verifier: this.id,
        tool: this.tool,
        toolSummary: '',
        toolStderr: baseline.stderr || '',
        reason: 'Failed to reach endpoint for baseline check',
        retryable: true,
      };
    }

    // 2. Probe with NoSQL Operator Payloads ($ne)
    // Build JSON or Query probe with {$ne: null} or {$ne: ""}
    const testUrl = new URL(endpoint);
    const params = Array.from(testUrl.searchParams.keys());
    const paramToTest = params[0] || 'username';

    // Construct curl command for JSON/Query NoSQL injection probe
    let probeArgv: string[];
    if (method === 'POST') {
      const jsonBody = JSON.stringify({ [paramToTest]: { '$ne': null }, password: { '$ne': null } });
      probeArgv = [
        'curl', '-s', '-i', '-X', 'POST',
        '-H', 'Content-Type: application/json',
        '-d', jsonBody,
        endpoint,
      ];
    } else {
      testUrl.searchParams.set(`${paramToTest}[$ne]`, 'random_non_existent_value_123');
      probeArgv = ['curl', '-s', '-i', '-X', 'GET', testUrl.toString()];
    }

    const probeExec = await context.runtime.execute({
      argv: probeArgv,
      timeoutMs: context.timeoutMs,
      network: 'internal',
    });

    const baselineBody = baseline.stdout;
    const probeBody = probeExec.stdout;

    // Check for indicators of success (e.g. HTTP 200/302, redirect, auth bypass token, or response length difference)
    const isSuccessStatus = /HTTP\/\d\.\d (200|302|301)/i.test(probeBody);
    const indicatesBypass = /welcome|dashboard|admin|token|logged_in/i.test(probeBody) || /Set-Cookie:/i.test(probeBody);
    const baselineFailed = /HTTP\/\d\.\d (401|403|400|500)/i.test(baselineBody) || /invalid|error|failed/i.test(baselineBody);

    const isConfirmed = isSuccessStatus && (indicatesBypass || baselineFailed);

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
        indicator: isConfirmed ? 'nosql:operator_injection_confirmed' : 'nosql:no_injection',
        category: 'tool_confirmation',
        detail: `Parameter tested: ${paramToTest}`,
        confidenceFactor: isConfirmed ? 0.35 : 0.0,
      },
      {
        indicator: 'endpoint:reachable',
        category: 'endpoint_reachability',
        detail: `Endpoint ${endpoint} responded`,
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
      parameter: paramToTest,
      reason: isConfirmed
        ? `NoSQL injection confirmed on '${paramToTest}' via operator payload ($ne)`
        : `NoSQL injection tested on '${paramToTest}' but no vulnerability confirmed`,
      indicator: isConfirmed ? `nosql:injection_point@${paramToTest}` : 'nosql:no_injection',
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
