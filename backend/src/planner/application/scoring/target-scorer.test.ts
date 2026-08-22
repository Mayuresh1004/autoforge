import { describe, expect, it } from 'vitest';
import { TargetScorer } from './target-scorer';
import { extractFeatures, summarizeFindings, categorizeFinding } from './feature-extractor';
import type { SurfaceInput, StaticVulnInput, ProfileInput } from '../../domain/models/plan-input';

const profile: ProfileInput = { language: 'javascript', framework: 'Express', technologies: ['Express'] };

const scorer = new TargetScorer();

function surface(partial: Partial<SurfaceInput>): SurfaceInput {
  return {
    url: 'http://app.test/api/login',
    method: 'POST',
    parameters: ['user', 'pass'],
    authentication: true,
    risk: 'HIGH',
    source: 'crawler',
    statusCode: 200,
    ...partial,
  };
}

function finding(partial: Partial<StaticVulnInput>): StaticVulnInput {
  return {
    type: 'B608',
    severity: 'HIGH',
    cwe: 'CWE-89',
    cve: null,
    confidence: 0.9,
    message: 'Possible SQL injection',
    ...partial,
  };
}

describe('TargetScorer', () => {
  it('ranks an auth + param + CRITICAL-static target into CRITICAL risk', () => {
    const features = extractFeatures(
      surface({ risk: 'HIGH', url: 'http://app.test/api/search?q=1' }),
      profile,
    );
    const summary = summarizeFindings([
      finding({ severity: 'CRITICAL', message: 'SQL injection in query builder' }),
    ]);
    const scored = scorer.score(features, summary);

    expect(scored.priority).toBeGreaterThanOrEqual(80);
    expect(scored.estimatedRisk).toBe('CRITICAL');
    expect(scored.candidateVulnerabilities).toContain('SQL Injection');
    expect(scored.recommendedTool).toBe('sqlmap');
    expect(scored.breakdown.length).toBeGreaterThanOrEqual(3);
    expect(scored.reason).toContain('priority');
  });

  it('upload + auth always lands CRITICAL regardless of raw priority', () => {
    const features = extractFeatures(
      surface({ url: 'http://app.test/upload', authentication: true, risk: 'LOW' }),
      profile,
    );
    const scored = scorer.score(features, summarizeFindings([]));
    expect(scored.estimatedRisk).toBe('CRITICAL');
    expect(scored.candidateVulnerabilities).toContain('Insecure File Upload');
  });

  it('public static/docs/health endpoints score LOW with no hypothesis', () => {
    const features = extractFeatures(
      surface({
        url: 'http://app.test/static/app.css',
        risk: 'LOW',
        authentication: false,
        parameters: [],
      }),
      profile,
    );
    const scored = scorer.score(features, summarizeFindings([]));
    expect(scored.estimatedRisk).toBe('LOW');
    expect(scored.priority).toBeLessThanOrEqual(20);
    expect(scored.candidateVulnerabilities).toHaveLength(0);
  });

  it('is explainable: breakdown labels every contributing factor', () => {
    const features = extractFeatures(surface({ url: 'http://app.test/api/search?q=1' }), profile);
    const scored = scorer.score(features, summarizeFindings([finding({ severity: 'HIGH' })]));
    const labels = scored.breakdown.map((f) => f.label);
    expect(labels).toContain('scout-risk HIGH');
    expect(labels).toContain('user-input query parameter');
    expect(labels).toContain('HIGH static finding');
    expect(scored.reason).toContain('(+' + scored.breakdown[0].points + ')');
  });

  it('categorizeFinding maps CWE/type/message to hypothesis categories', () => {
    expect(categorizeFinding(finding({ cwe: 'CWE-89' }))).toContain('SQL Injection');
    expect(categorizeFinding(finding({ cwe: 'CWE-79', type: 'XSS' }))).toContain('Cross-Site Scripting');
    expect(categorizeFinding(finding({ message: 'SSRF via user url' }))).toContain('Server-Side Request Forgery');
    expect(categorizeFinding(finding({ cwe: 'CWE-200', message: 'Exposed sensitive configuration' }))).toContain('Security Misconfiguration');
  });

  it('Phase 9 Target Generation: /api/debug/config yields Security Misconfiguration, never SQL Injection', () => {
    const features = extractFeatures(
      surface({ url: 'http://app.test/api/debug/config', parameters: [], risk: 'HIGH' }),
      profile,
    );
    const summary = summarizeFindings([
      finding({ cwe: 'CWE-89', message: 'SQL injection in search' }),
      finding({ cwe: 'CWE-200', message: 'Exposed config' }),
    ]);
    const scored = scorer.score(features, summary);

    expect(scored.candidateVulnerabilities).toContain('Security Misconfiguration');
    expect(scored.candidateVulnerabilities).not.toContain('SQL Injection');
  });

  it('Phase 9 Target Generation: /api/users/:id yields Broken Access Control, never SQL Injection', () => {
    const features = extractFeatures(
      surface({ url: 'http://app.test/api/users/:id', parameters: ['id'], risk: 'HIGH' }),
      profile,
    );
    const summary = summarizeFindings([
      finding({ cwe: 'CWE-284', message: 'Broken access control' }),
    ]);
    const scored = scorer.score(features, summary);

    expect(scored.candidateVulnerabilities).toContain('Broken Access Control');
    expect(scored.candidateVulnerabilities).not.toContain('SQL Injection');
  });
});
