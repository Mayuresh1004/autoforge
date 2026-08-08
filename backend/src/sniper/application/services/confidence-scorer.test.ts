import { describe, expect, it } from 'vitest';
import { scoreConfidence } from '../../application/services/confidence-scorer';
import type { ConfidenceSignals } from '../../application/services/confidence-scorer';

/** Deterministic, explainable confidence — never an LLM number. */
describe('scoreConfidence', () => {
  it('is a weighted sum of five explainable factors', () => {
    const breakdown = scoreConfidence({
      toolConfirmed: true,
      techniqueCount: 3,
      responseMatched: true,
      endpointReachable: true,
      staticCorrelation: 'confirmed',
    });
    expect(breakdown.factors).toHaveLength(5);
    expect(breakdown.score).toBeGreaterThan(0.9);
  });

  it('explains every factor with a category + reason', () => {
    const breakdown = scoreConfidence({
      toolConfirmed: true,
      techniqueCount: 1,
      responseMatched: false,
      endpointReachable: true,
      staticCorrelation: 'partial',
    });
    const categories = breakdown.factors.map((f) => f.category);
    expect(categories).toContain('tool_confirmation');
    expect(categories).toContain('reproducibility');
    expect(categories).toContain('response_behavior');
    expect(categories).toContain('static_correlation');
    expect(categories).toContain('endpoint_reachability');
    for (const f of breakdown.factors) expect(f.reason.length).toBeGreaterThan(3);
  });

  it('collapses to zero for a contradictory/non-verified target', () => {
    const breakdown = scoreConfidence({
      toolConfirmed: false,
      techniqueCount: 0,
      responseMatched: false,
      endpointReachable: false,
      staticCorrelation: 'none',
    });
    expect(breakdown.score).toBe(0);
  });

  it('is deterministic: identical signals → identical score', () => {
    const signals: ConfidenceSignals = {
      toolConfirmed: true,
      techniqueCount: 2,
      responseMatched: true,
      endpointReachable: true,
      staticCorrelation: 'confirmed',
    };
    expect(scoreConfidence(signals)).toEqual(scoreConfidence(signals));
  });});
