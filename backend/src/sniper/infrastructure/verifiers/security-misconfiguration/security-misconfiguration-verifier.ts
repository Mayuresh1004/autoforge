import type {
  EvidenceItem,
  VerificationContext,
  VerificationOutcome,
  VerificationTarget,
} from '../../../domain/models/verification';
import type { VulnerabilityType } from '../../../domain/models/vulnerability-type';
import type { VulnerabilityVerifier } from '../../../domain/ports/vulnerability-verifier';
import { SECURITY_MISCONFIGURATION } from '../../../domain/models/vulnerability-type';
import { scoreConfidence } from '../../../application/services/confidence-scorer';
import { summarizeOutput } from '../../tools/sqlmap/sqlmap-redact';

export interface SecurityMisconfigurationVerifierOptions {
  readonly summarizeBytes?: number;
}

export class SecurityMisconfigurationVerifier implements VulnerabilityVerifier {
  readonly id = 'security-misconfiguration';
  readonly tool = 'misconfig-prober';

  private readonly summarizeBytes: number;

  constructor(options: SecurityMisconfigurationVerifierOptions = {}) {
    this.summarizeBytes = options.summarizeBytes ?? 4_000;
  }

  supports(type: VulnerabilityType): boolean {
    return type === SECURITY_MISCONFIGURATION;
  }

  async verify(target: VerificationTarget, context: VerificationContext): Promise<VerificationOutcome> {
    const endpoint = target.endpoint;
    const method = target.method.toUpperCase();

    // 0. Optional RAG Guidance retrieval
    if (context.rag) {
      try {
        await context.rag.search({
          query: 'security misconfiguration debug config credentials disclosure verification',
          topK: 1,
          filters: { vulnerabilityType: 'SECURITY_MISCONFIGURATION' },
        });
      } catch {
        // Fallback gracefully
      }
    }

    // 1. Probe the endpoint
    const probeArgv = ['curl', '-s', '-i', '-X', method];
    if (target.credentials?.header) {
      probeArgv.push('-H', target.credentials.header);
    }
    probeArgv.push(endpoint);

    const probeExec = await context.runtime.execute({
      argv: probeArgv,
      timeoutMs: context.timeoutMs,
      network: 'internal',
    });

    if (probeExec.exitCode !== 0 && !probeExec.stdout) {
      return {
        status: 'INCONCLUSIVE',
        confidence: { score: 0, weighted: true, factors: [] },
        evidence: [],
        verifier: this.id,
        tool: this.tool,
        toolSummary: summarizeOutput(probeExec.stdout, this.summarizeBytes),
        toolStderr: summarizeOutput(probeExec.stderr, this.summarizeBytes),
        reason: `Failed to reach security misconfiguration endpoint: ${endpoint}`,
        retryable: true,
      };
    }

    const responseText = probeExec.stdout || '';

    // 2. Evaluation criteria
    // Condition A: HTTP 200 OK
    const is200 = /HTTP\/\d\.\d 200/i.test(responseText);
    const isProtected = /HTTP\/\d\.\d (401|403|404|500)/i.test(responseText);

    // Condition B: Sensitive indicators in body (JWT secrets, default admin creds, db path, debug flags, phpinfo)
    const sensitiveIndicators = [
      'jwtSecret',
      'jwt_secret',
      'defaultAdmin',
      'default_admin',
      'admin123',
      'dbPath',
      'db_path',
      'PHP Version',
      'Document Root',
      '"debug": true',
      '"debug":true',
    ];

    const lowerResponse = responseText.toLowerCase();
    const matchedIndicators = sensitiveIndicators.filter((ind) =>
      lowerResponse.includes(ind.toLowerCase())
    );

    const isConfirmed = is200 && !isProtected && matchedIndicators.length > 0;
    const status = isConfirmed ? 'CONFIRMED' : 'NOT_CONFIRMED';

    const staticCorrelation = correlationLevel(context);

    const confidence = scoreConfidence({
      toolConfirmed: isConfirmed,
      techniqueCount: isConfirmed ? matchedIndicators.length : 0,
      responseMatched: isConfirmed,
      endpointReachable: true,
      staticCorrelation,
    });

    const evidence: EvidenceItem[] = [
      {
        indicator: isConfirmed
          ? 'security_misconfig:sensitive_config_disclosed'
          : isProtected
            ? 'security_misconfig:endpoint_protected'
            : 'security_misconfig:no_sensitive_indicators',
        category: 'tool_confirmation',
        detail: isConfirmed
          ? `Disclosed sensitive config keys: [${matchedIndicators.join(', ')}] at ${endpoint}`
          : isProtected
            ? `Endpoint restricted or missing (${responseText.slice(0, 80).replace(/\r?\n/g, ' ')})`
            : `Endpoint ${endpoint} responded 200 OK but contained no sensitive configuration indicators`,
        confidenceFactor: isConfirmed ? 0.95 : 0.0,
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
      reason: isConfirmed
        ? `Security misconfiguration confirmed on '${endpoint}': exposed sensitive data [${matchedIndicators.join(', ')}]`
        : `Security misconfiguration check on '${endpoint}': protected or no sensitive data disclosed`,
      indicator: isConfirmed ? 'security_misconfig:disclosed' : 'security_misconfig:safe',
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
