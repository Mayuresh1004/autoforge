import type {
  EvidenceItem,
  VerificationContext,
  VerificationOutcome,
  VerificationTarget,
} from '../../../domain/models/verification';
import type { VulnerabilityType } from '../../../domain/models/vulnerability-type';
import type { VulnerabilityVerifier } from '../../../domain/ports/vulnerability-verifier';
import { SSRF } from '../../../domain/models/vulnerability-type';
import { scoreConfidence } from '../../../application/services/confidence-scorer';
import { summarizeOutput } from '../../tools/sqlmap/sqlmap-redact';

export interface SsrfVerifierOptions {
  readonly summarizeBytes?: number;
}

export class SsrfVerifier implements VulnerabilityVerifier {
  readonly id = 'ssrf';
  readonly tool = 'ssrf-prober';

  private readonly summarizeBytes: number;

  constructor(options: SsrfVerifierOptions = {}) {
    this.summarizeBytes = options.summarizeBytes ?? 4_000;
  }

  supports(type: VulnerabilityType): boolean {
    return type === SSRF;
  }

  async verify(target: VerificationTarget, context: VerificationContext): Promise<VerificationOutcome> {
    const endpoint = target.endpoint;
    const method = target.method.toUpperCase();

    // 0. Optional RAG Guidance retrieval
    if (context.rag) {
      try {
        await context.rag.search({
          query: 'ssrf internal service access loopback metadata verification',
          topK: 1,
          filters: { vulnerabilityType: 'SSRF' },
        });
      } catch {
        // Fallback gracefully
      }
    }

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
        reason: 'Failed to reach SSRF target endpoint during baseline check',
        retryable: true,
      };
    }

    // 2. Probe with Internal / Loopback Target Payload
    // Determine parameter name to target (e.g. url, target, webhook, feed)
    const targetUrlObj = new URL(endpoint);
    const params = Array.from(targetUrlObj.searchParams.keys());
    const paramToTest = target.verificationHints?.parameterName || params[0] || 'url';
    const internalTargetPayload = 'http://127.0.0.1:8000/health';

    let probeArgv: string[];
    if (method === 'POST') {
      const jsonBody = JSON.stringify({ [paramToTest]: internalTargetPayload });
      probeArgv = [
        'curl', '-s', '-i', '-X', 'POST',
        '-H', 'Content-Type: application/json',
        '-d', jsonBody,
        endpoint,
      ];
    } else {
      targetUrlObj.searchParams.set(paramToTest, internalTargetPayload);
      probeArgv = ['curl', '-s', '-i', '-X', 'GET', targetUrlObj.toString()];
    }

    if (target.credentials?.header) {
      probeArgv.push('-H', target.credentials.header);
    }

    const probeExec = await context.runtime.execute({
      argv: probeArgv,
      timeoutMs: context.timeoutMs,
      network: 'internal',
    });

    const probeResponseBody = probeExec.stdout;

    // 3. Verification Criteria Evaluation (RAG standard):
    // Condition 1: HTTP 200/201 response containing internal payload evidence (e.g. {"status":"UP"} or metadata)
    const isSuccessStatus = /HTTP\/\d\.\d (200|201)/i.test(probeResponseBody);
    const containsInternalData =
      probeResponseBody.includes('"status":"UP"') ||
      probeResponseBody.includes('status') ||
      probeResponseBody.includes('UP') ||
      probeResponseBody.includes('ami-id') ||
      probeResponseBody.includes('instance-id') ||
      /internal_health_check|server_status|meta-data/i.test(probeResponseBody);

    // Condition 2: Explicit rejection or block (HTTP 400 with "Forbidden target URL or IP address" or connection failure)
    const isBlocked =
      /HTTP\/\d\.\d (400|403)/i.test(probeResponseBody) &&
      (/forbidden|blocked|private ip|invalid target/i.test(probeResponseBody) || !containsInternalData);

    const isConfirmed = isSuccessStatus && containsInternalData && !isBlocked;

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
          ? 'ssrf:internal_endpoint_accessed'
          : isBlocked
            ? 'ssrf:private_ip_blocked'
            : 'ssrf:no_ssrf',
        category: 'tool_confirmation',
        detail: isConfirmed
          ? `Server fetched internal URL ${internalTargetPayload} and returned internal payload`
          : `SSRF probe to ${internalTargetPayload} was refused or blocked by server`,
        confidenceFactor: isConfirmed ? 0.95 : 0.0,
      },
      {
        indicator: 'endpoint:reachable',
        category: 'endpoint_reachability',
        detail: `Endpoint ${endpoint} responded to HTTP ${method} probe`,
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
        ? `SSRF confirmed on '${paramToTest}': server successfully fetched internal target ${internalTargetPayload}`
        : `SSRF tested on '${paramToTest}': server properly blocked or failed to fetch internal target`,
      indicator: isConfirmed ? `ssrf:injection_point@${paramToTest}` : 'ssrf:no_ssrf',
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
