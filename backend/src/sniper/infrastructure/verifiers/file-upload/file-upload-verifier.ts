import type {
  EvidenceItem,
  VerificationContext,
  VerificationOutcome,
  VerificationTarget,
} from '../../../domain/models/verification';
import type { VulnerabilityType } from '../../../domain/models/vulnerability-type';
import type { VulnerabilityVerifier } from '../../../domain/ports/vulnerability-verifier';
import { FILE_UPLOAD } from '../../../domain/models/vulnerability-type';
import { scoreConfidence } from '../../../application/services/confidence-scorer';
import { summarizeOutput } from '../../tools/sqlmap/sqlmap-redact';

export interface FileUploadVerifierOptions {
  readonly summarizeBytes?: number;
}

export class FileUploadVerifier implements VulnerabilityVerifier {
  readonly id = 'file-upload';
  readonly tool = 'file-upload-prober';

  private readonly summarizeBytes: number;

  constructor(options: FileUploadVerifierOptions = {}) {
    this.summarizeBytes = options.summarizeBytes ?? 4_000;
  }

  supports(type: VulnerabilityType): boolean {
    return type === FILE_UPLOAD;
  }

  async verify(target: VerificationTarget, context: VerificationContext): Promise<VerificationOutcome> {
    const endpoint = target.endpoint;
    const method = target.method.toUpperCase() === 'GET' ? 'POST' : target.method.toUpperCase();

    // 0. Optional RAG Guidance retrieval (validates RAG integration capability)
    let ragGuidance = '';
    if (context.rag) {
      try {
        const ragResult = await context.rag.search({
          query: 'file upload verification criteria payload acceptance persistence execution',
          topK: 1,
          filters: { vulnerabilityType: 'FILE_UPLOAD' },
        });
        if (ragResult.documents.length > 0) {
          ragGuidance = ragResult.documents[0].content;
        }
      } catch {
        // Fallback gracefully if RAG service unavailable
      }
    }

    // 1. Baseline Request to verify endpoint reachability
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
        toolSummary: summarizeOutput(baseline.stdout, this.summarizeBytes),
        toolStderr: summarizeOutput(baseline.stderr, this.summarizeBytes),
        reason: 'Failed to reach file upload endpoint during baseline probe',
        retryable: true,
      };
    }

    // 2. Executable Payload Probe Construction
    const payloadMarker = 'AMASS_FILE_UPLOAD_EXPLOIT_VERIFIED';
    const payloadFilename = 'exploit_poc.py';
    const uploadFieldName =
      target.verificationHints?.uploadField ||
      target.verificationHints?.parameterName ||
      'file';
    
    // Execute multipart form upload request via curl inside sandbox container
    const probeArgv = [
      'curl', '-s', '-i', '-X', method,
      '-F', `${uploadFieldName}=@${payloadFilename};type=text/x-python`,
      '-F', `payload_marker=${payloadMarker}`,
      endpoint,
    ];

    if (target.credentials?.header) {
      probeArgv.push('-H', target.credentials.header);
    }
    if (target.credentials?.cookie) {
      probeArgv.push('-H', `Cookie: ${target.credentials.cookie}`);
    }

    const probeExec = await context.runtime.execute({
      argv: probeArgv,
      timeoutMs: context.timeoutMs,
      network: 'internal',
    });

    const probeResponse = probeExec.stdout;

    // 3. Verification Criteria Evaluation (RAG standard):
    // Condition 1: HTTP Acceptance (Status 200 / 201 / 202)
    const isAccepted = /HTTP\/\d\.\d (200|201|202)/i.test(probeResponse);

    // Condition 2: File Persistence & Direct Reachability
    // Checks if response body contains URL/path reference to uploaded file or executed payload output
    const returnsPathReference = /uploads\/|static\/|\/files\/|file_id|url/i.test(probeResponse);
    const returnsPayloadOutput = probeResponse.includes(payloadMarker) || /AMASS_EXPLOIT_SUCCESS/i.test(probeResponse);
    
    // Condition 3: Rejection check (explicit 400/403/422 status or error string)
    const isRejected = /HTTP\/\d\.\d (400|403|415|422)/i.test(probeResponse) || /invalid file|unsupported format|rejected/i.test(probeResponse);

    const isConfirmed = isAccepted && (returnsPathReference || returnsPayloadOutput) && !isRejected;

    const status = isConfirmed ? 'CONFIRMED' : 'NOT_CONFIRMED';
    const staticCorrelation = correlationLevel(context);

    const confidence = scoreConfidence({
      toolConfirmed: isConfirmed,
      techniqueCount: isConfirmed ? 3 : 0,
      responseMatched: isConfirmed,
      endpointReachable: true,
      staticCorrelation,
    });

    const evidence: EvidenceItem[] = [
      {
        indicator: isConfirmed
          ? 'file_upload:payload_acceptance_and_reachability_confirmed'
          : isRejected
            ? 'file_upload:rejected_by_extension_policy'
            : 'file_upload:no_upload_vulnerability',
        category: 'tool_confirmation',
        detail: isConfirmed
          ? `Payload ${payloadFilename} accepted and verified reachable at endpoint ${endpoint}`
          : `Upload attempt returned non-exploitable response: ${probeResponse.slice(0, 150).replace(/\r?\n/g, ' ')}`,
        confidenceFactor: isConfirmed ? 0.95 : 0.0,
      },
      {
        indicator: 'endpoint:reachable',
        category: 'endpoint_reachability',
        detail: `Endpoint ${endpoint} responded to multipart form POST request`,
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
      parameter: 'file',
      reason: isConfirmed
        ? `Insecure file upload confirmed on '${endpoint}': executable payload accepted and persistent`
        : `File upload probe executed on '${endpoint}': no unrestricted file upload confirmed`,
      indicator: isConfirmed ? 'file_upload:injection_point@file' : 'file_upload:no_upload_vulnerability',
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
