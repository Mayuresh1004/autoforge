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
import { SQL_INJECTION } from '../../../domain/models/vulnerability-type';
import { classifySqlMap, type SqlMapClassification } from '../../../application/services/sqlmap-classifier';
import { scoreConfidence } from '../../../application/services/confidence-scorer';
import { SqlMapAdapter } from '../../tools/sqlmap/sqlmap-adapter';
import { parseSqlMapOutput, type ParsedSqlMapOutput } from '../../tools/sqlmap/sqlmap-output-parser';
import { summarizeOutput } from '../../tools/sqlmap/sqlmap-redact';

export interface SqlInjectionVerifierOptions {
  /** Cap for the persisted tool summary (bytes). */
  readonly summarizeBytes?: number;
}

/**
 * SQL Injection verifier. Decides whether a planned injection target is
 * actually exploitable by running a bounded, sandbox-bound sqlmap session and
 * translating the parsed output into a deterministic verdict + evidence.
 *
 * Pure orchestration over deterministic helpers — the adapter, parser,
 * classifier and confidence scorer are each independently unit-tested.
 */
export class SqlInjectionVerifier implements VulnerabilityVerifier {
  readonly id = 'sql-injection';
  readonly tool = 'sqlmap';

  private readonly summarizeBytes: number;

  constructor(options: SqlInjectionVerifierOptions = {}) {
    this.summarizeBytes = options.summarizeBytes ?? 4_000;
  }

  supports(type: VulnerabilityType): boolean {
    return type === SQL_INJECTION;
  }

  async verify(target: VerificationTarget, context: VerificationContext): Promise<VerificationOutcome> {
    const adapter = new SqlMapAdapter(context.runtime);
    const execution = await adapter.run({
      url: target.endpoint,
      method: target.method,
      cookie: target.credentials?.cookie,
      authHeader: target.credentials?.header,
      timeoutMs: context.timeoutMs,
    });

    const parsed = parseSqlMapOutput(execution.stdout, execution.stderr);
    const staticCorrelation = correlationLevel(context);
    const classified = classifySqlMap({ parsed, execution, staticCorrelation });
    const confidence = scoreConfidence(classified.signals);
    const evidence = buildEvidence(parsed, classified, confidence, staticCorrelation);

    return {
      status: classified.status,
      confidence,
      evidence,
      verifier: this.id,
      tool: this.tool,
      toolSummary: summarizeOutput(execution.stdout, this.summarizeBytes),
      toolStderr: summarizeOutput(execution.stderr, this.summarizeBytes),
      parameter: parsed.parameter ?? undefined,
      reason: classified.reason,
      indicator:
        classified.status === 'CONFIRMED'
          ? parsed.parameter
            ? `sqlmap:injection_point@${parsed.parameter}`
            : 'sqlmap:injection_point'
          : parsed.noInjection
            ? 'sqlmap:no_injection'
            : undefined,
      retryable: classified.retryable,
    };
  }
}

function correlationLevel(context: VerificationContext): 'confirmed' | 'partial' | 'none' {
  const finding = context.staticCorrelation?.finding;
  if (!finding) return 'none';
  const confidence = typeof finding.confidence === 'number' ? finding.confidence : 0;
  return confidence >= 0.5 ? 'confirmed' : 'partial';
}

function buildEvidence(
  parsed: ParsedSqlMapOutput,
  classified: SqlMapClassification,
  confidence: ConfidenceBreakdown,
  staticCorrelation: 'confirmed' | 'partial' | 'none'
): readonly EvidenceItem[] {
  const byCategory = new Map(confidence.factors.map((f) => [f.category, f.score]));
  const factor = (category: ConfidenceFactorCategory): number => byCategory.get(category) ?? 0;

  const items: EvidenceItem[] = [];

  items.push({
    indicator: parsed.vulnerable ? 'sqlmap:injection_point' : 'sqlmap:no_injection',
    category: 'tool_confirmation',
    detail: parsed.parameter
      ? `parameter=${parsed.parameter}, method=${parsed.method ?? '?'}`
      : parsed.noInjection
        ? 'sqlmap ruled out every tested parameter'
        : 'no definitive tool signal',
    confidenceFactor: factor('tool_confirmation'),
  });

  items.push({
    indicator: parsed.techniques.length > 0 ? 'sqlmap:techniques' : 'reproducibility:none',
    category: 'reproducibility',
    detail:
      parsed.techniques.length > 0
        ? parsed.techniques.join(', ')
        : `${parsed.payloadCount} payload(s) observed`,
    confidenceFactor: factor('reproducibility'),
  });

  items.push({
    indicator: parsed.dbms ? 'sqlmap:dbms_identified' : 'response_behavior:unmatched',
    category: 'response_behavior',
    detail: parsed.dbms ? `back-end DBMS: ${parsed.dbms}` : 'no database indicator observed',
    confidenceFactor: factor('response_behavior'),
  });

  items.push({
    indicator:
      staticCorrelation === 'none' ? 'static:none' : `static:${staticCorrelation}`,
    category: 'static_correlation',
    detail:
      staticCorrelation === 'confirmed'
        ? 'correlated static finding with confidence ≥ 0.5'
        : staticCorrelation === 'partial'
          ? 'correlated static finding with low confidence'
          : 'no correlated static finding',
    confidenceFactor: factor('static_correlation'),
  });

  items.push({
    indicator: parsed.reached ? 'endpoint:reachable' : 'endpoint:unreachable',
    category: 'endpoint_reachability',
    detail: parsed.reached
      ? 'sqlmap communicated with the endpoint'
      : 'no communication with the endpoint',
    confidenceFactor: factor('endpoint_reachability'),
  });

  return items;
}