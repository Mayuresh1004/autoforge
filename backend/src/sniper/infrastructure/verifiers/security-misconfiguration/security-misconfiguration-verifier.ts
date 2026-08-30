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
    const method = (target.method || 'GET').toUpperCase();

    // 0. Optional RAG Guidance retrieval
    if (context.rag) {
      try {
        await context.rag.search({
          query: 'security misconfiguration debug endpoint information disclosure sensitive config exposure',
          topK: 1,
          filters: { vulnerabilityType: 'SECURITY_MISCONFIGURATION' },
        });
      } catch {
        // Fallback gracefully
      }
    }

    // 1. Send HTTP request to target endpoint
    const probeArgv = ['curl', '-s', '-i', '-X', method, endpoint];

    const probeExec = await context.runtime.execute({
      argv: probeArgv,
      timeoutMs: context.timeoutMs,
      network: 'internal',
    });

    const probeResponse = probeExec.stdout || '';

    // 2. Evaluate response:
    // HTTP 200 OK AND disclosures of sensitive internal environment/configuration fields
    const isSuccessStatus = /HTTP\/\d\.\d (200)/i.test(probeResponse);
    const hasSensitiveDisclosure =
      /node_env|db_password|jwt_secret|app_secret|process\.env|debugConfig|sensitiveConfig|database_url|api_key|jwtSecret|nodeEnv|dbPath|defaultAdmin/i.test(probeResponse) ||
      (/debug/i.test(endpoint) && /env|config|secret|password|key/i.test(probeResponse));

    const isProtected = /HTTP\/\d\.\d (403|404|401)/i.test(probeResponse) || /forbidden|unauthorized|disabled|not found/i.test(probeResponse);

    const isConfirmed = isSuccessStatus && hasSensitiveDisclosure && !isProtected;

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
          ? 'misconfig:sensitive_config_disclosed'
          : isProtected
            ? 'misconfig:endpoint_restricted_or_disabled'
            : 'misconfig:no_sensitive_disclosure',
        category: 'tool_confirmation',
        detail: isConfirmed
          ? `Security misconfiguration confirmed at ${endpoint}: endpoint disclosed sensitive debug/environment config with HTTP 200`
          : `Probe at ${endpoint} returned status: ${probeResponse.slice(0, 100).replace(/\r?\n/g, ' ')}`,
        confidenceFactor: isConfirmed ? 0.95 : 0.0,
      },
      {
        indicator: 'endpoint:reachable',
        category: 'endpoint_reachability',
        detail: `Endpoint ${endpoint} responded to probe`,
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
      reason: isConfirmed
        ? `Security Misconfiguration confirmed on '${endpoint}': sensitive debug/environment config disclosed`
        : `Security Misconfiguration probe executed on '${endpoint}': endpoint properly restricted or disabled`,
      indicator: isConfirmed ? 'misconfig:sensitive_config_exposure' : 'misconfig:protected',
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
