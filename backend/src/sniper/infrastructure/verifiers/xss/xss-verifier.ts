import type {
  EvidenceItem,
  VerificationContext,
  VerificationOutcome,
  VerificationTarget,
} from '../../../domain/models/verification';
import type { VulnerabilityType } from '../../../domain/models/vulnerability-type';
import type { VulnerabilityVerifier } from '../../../domain/ports/vulnerability-verifier';
import { XSS } from '../../../domain/models/vulnerability-type';
import { scoreConfidence } from '../../../application/services/confidence-scorer';
import { summarizeOutput } from '../../tools/sqlmap/sqlmap-redact';

export interface XssVerifierOptions {
  readonly summarizeBytes?: number;
}

export class XssVerifier implements VulnerabilityVerifier {
  readonly id = 'xss';
  readonly tool = 'xss-prober';

  private readonly summarizeBytes: number;

  constructor(options: XssVerifierOptions = {}) {
    this.summarizeBytes = options.summarizeBytes ?? 4_000;
  }

  supports(type: VulnerabilityType): boolean {
    return type === XSS;
  }

  async verify(target: VerificationTarget, context: VerificationContext): Promise<VerificationOutcome> {
    const endpoint = target.endpoint;
    const method = target.method.toUpperCase();

    // 0. Optional RAG Guidance retrieval
    if (context.rag) {
      try {
        await context.rag.search({
          query: 'xss unescaped payload reflection text html execution context verification',
          topK: 1,
          filters: { vulnerabilityType: 'XSS' },
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
        reason: 'Failed to reach XSS target endpoint during baseline check',
        retryable: true,
      };
    }

    // 2. Unescaped Script Payload Probe
    const xssPayload = "<script>alert('AMASS_XSS_VERIFIED')</script>";
    const targetUrlObj = new URL(endpoint);
    const params = Array.from(targetUrlObj.searchParams.keys());
    const paramToTest = target.verificationHints?.parameterName || params[0] || 'q';

    let probeArgv: string[];
    if (method === 'POST') {
      const jsonBody = JSON.stringify({ [paramToTest]: xssPayload });
      probeArgv = [
        'curl', '-s', '-i', '-X', 'POST',
        '-H', 'Content-Type: application/json',
        '-d', jsonBody,
        endpoint,
      ];
    } else {
      targetUrlObj.searchParams.set(paramToTest, xssPayload);
      probeArgv = ['curl', '-s', '-i', '-X', 'GET', targetUrlObj.toString()];
    }

    const probeExec = await context.runtime.execute({
      argv: probeArgv,
      timeoutMs: context.timeoutMs,
      network: 'internal',
    });

    const probeResponse = probeExec.stdout;

    // 3. Verification Criteria Evaluation (RAG standard):
    // Condition 1: Content-Type header must be HTML (text/html or application/xhtml+xml)
    const isHtmlResponse = /Content-Type:\s*text\/html/i.test(probeResponse) || /Content-Type:\s*application\/xhtml\+xml/i.test(probeResponse);

    // Condition 2: Unescaped Script Payload Reflection in Body (NOT entity encoded &lt;script&gt;)
    const hasUnescapedPayload = probeResponse.includes(xssPayload);

    // Condition 3: Disqualification if JSON or plain text response
    const isJsonOrText = /Content-Type:\s*application\/json/i.test(probeResponse) || /Content-Type:\s*text\/plain/i.test(probeResponse);

    const isConfirmed = isHtmlResponse && hasUnescapedPayload && !isJsonOrText;

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
          ? 'xss:reflected_script_injection'
          : isJsonOrText
            ? 'xss:safe_json_or_text_response'
            : 'xss:escaped_or_not_reflected',
        category: 'tool_confirmation',
        detail: isConfirmed
          ? `Payload ${xssPayload} reflected unescaped in text/html response body`
          : `Payload was escaped, ignored, or returned in non-executable Content-Type`,
        confidenceFactor: isConfirmed ? 0.95 : 0.0,
      },
      {
        indicator: 'endpoint:reachable',
        category: 'endpoint_reachability',
        detail: `Endpoint ${endpoint} responded to XSS probe`,
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
        ? `Reflected XSS confirmed on '${paramToTest}': unescaped script tag returned in text/html response`
        : `XSS probe executed on '${paramToTest}': payload escaped, safe template binding, or non-HTML Content-Type`,
      indicator: isConfirmed ? `xss:injection_point@${paramToTest}` : 'xss:no_xss',
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
