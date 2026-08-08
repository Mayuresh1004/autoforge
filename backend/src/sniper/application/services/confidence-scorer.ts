import type {
  ConfidenceBreakdown,
  ConfidenceFactor,
  ConfidenceFactorCategory,
} from '../../domain/models/verification';

/**
 * Deterministic, explainable confidence scoring. A score is NEVER an LLM
 * guess: it is the weighted sum of structured signals (tool confirmation,
 * reproducibility, response behavior, static-finding correlation, endpoint
 * reachability), each with a human-readable reason.
 */

export type StaticCorrelationLevel = 'confirmed' | 'partial' | 'none';

export interface ConfidenceSignals {
  readonly toolConfirmed: boolean;
  /** Distinct techniques sqlmap confirmed (reproducibility). */
  readonly techniqueCount: number;
  readonly responseMatched: boolean;
  readonly endpointReachable: boolean;
  readonly staticCorrelation: StaticCorrelationLevel;
}

const WEIGHTS: Record<ConfidenceFactorCategory, number> = {
  tool_confirmation: 0.35,
  reproducibility: 0.2,
  response_behavior: 0.15,
  static_correlation: 0.2,
  endpoint_reachability: 0.1,
};

function factor(
  category: ConfidenceFactorCategory,
  score: number,
  reason: string
): ConfidenceFactor {
  return { category, score, reason };
}

/** Deterministic scoring — pure function, unit-tested exhaustively. */
export function scoreConfidence(signals: ConfidenceSignals): ConfidenceBreakdown {
  const factors: ConfidenceFactor[] = [];

  factors.push(
    factor(
      'tool_confirmation',
      signals.toolConfirmed ? 1 : 0,
      signals.toolConfirmed
        ? 'verification tool reported a confirmed injection point'
        : 'verification tool reported no injectable parameter'
    )
  );

  const reproScore = signals.techniqueCount >= 2 ? 1 : signals.techniqueCount === 1 ? 0.5 : 0;
  factors.push(
    factor(
      'reproducibility',
      reproScore,
      signals.techniqueCount === 0
        ? 'no payload technique reproduced'
        : signals.techniqueCount === 1
          ? 'single payload technique reproduced'
          : `${signals.techniqueCount} independent payload techniques reproduced`
    )
  );

  factors.push(
    factor(
      'response_behavior',
      signals.responseMatched ? 1 : 0,
      signals.responseMatched
        ? 'observed back-end DBMS / expected error behavior'
        : 'response behavior did not match an expected database indicator'
    )
  );

  const staticScore =
    signals.staticCorrelation === 'confirmed'
      ? 1
      : signals.staticCorrelation === 'partial'
        ? 0.5
        : 0;
  factors.push(
    factor(
      'static_correlation',
      staticScore,
      signals.staticCorrelation === 'confirmed'
        ? 'static scan finding of the same type with high confidence'
        : signals.staticCorrelation === 'partial'
          ? 'static scan finding of the same type with low confidence'
          : 'no correlated static finding'
    )
  );

  factors.push(
    factor(
      'endpoint_reachability',
      signals.endpointReachable ? 1 : 0,
      signals.endpointReachable
        ? 'endpoint reachable from the sandbox'
        : 'endpoint unreachable from the sandbox'
    )
  );

  let score = 0;
  for (const f of factors) score += f.score * WEIGHTS[f.category];
  score = Math.round(score * 1000) / 1000;

  return { score, weighted: true, factors };
}