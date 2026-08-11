import { describe, it, expect } from 'vitest';
import {
  normalizeRoutePath,
  routesOverlap,
  findingMatchesExploit,
  buildDetectionReport,
  buildReconReport,
  type ExploitView,
  type VulnerabilityView,
} from './ground-truth';
import { parseCorpus, CorpusValidationError, findApp, normalizeRepoUrl } from './corpus';
import type { CorpusApp } from './corpus';

const NODEGOAT: CorpusApp = {
  id: 'nodegoat',
  name: 'OWASP NodeGoat',
  repoUrl: 'https://github.com/OWASP/NodeGoat.git',
  runtime: { strategy: 'repo-dockerfile', port: 8080, healthPath: '/' },
  expectedSurface: ['/', '/login', '/memos', '/memos/:id'],
  groundTruth: [
    {
      id: 'sqli-memos',
      cweId: 'CWE-89',
      vulnerabilityType: 'SQL_INJECTION',
      title: 'SQLi',
      severity: 'HIGH',
      scope: 'sniper',
      routes: [{ path: '/memos', method: 'GET', parameter: 'userId' }],
    },
    {
      id: 'xss-memos',
      cweId: 'CWE-79',
      vulnerabilityType: 'XSS',
      title: 'Stored XSS',
      scope: 'static',
      routes: [{ path: '/memos/:id', method: 'GET' }],
    },
    {
      id: 'idor-memos',
      cweId: 'CWE-639',
      title: 'IDOR',
      scope: 'future',
      routes: [{ path: '/memos/:id', method: 'GET' }],
    },
  ],
};

function exploit(partial: Partial<ExploitView>): ExploitView {
  return {
    id: 'exp-1',
    endpoint: 'http://172.18.0.3:8080/memos?userId=1',
    method: 'GET',
    parameter: 'userId',
    vulnerabilityType: 'SQL_INJECTION',
    cweId: 'CWE-89',
    status: 'CONFIRMED',
    ...partial,
  };
}

function vuln(partial: Partial<VulnerabilityView>): VulnerabilityView {
  return { id: 'v-1', cweId: 'CWE-79', vulnType: 'XSS', status: 'DETECTED', filePath: null, ...partial };
}

describe('normalizeRoutePath', () => {
  it('collapses id-like segments to :param', () => {
    expect(normalizeRoutePath('/memos/123')).toBe('/memos/:param');
    expect(normalizeRoutePath('/memos/:id')).toBe('/memos/:param');
    expect(normalizeRoutePath('/memos/{id}')).toBe('/memos/:param');
    expect(normalizeRoutePath('/memos/<id>')).toBe('/memos/:param');
    expect(normalizeRoutePath('/users/abcd1234abcd1234abcd1234')).toBe('/users/:param'); // object id
    expect(normalizeRoutePath('/users/550e8400-e29b-41d4-a716-446655440000')).toBe('/users/:param'); // uuid
  });
  it('keeps literal segments case-normalized and strips query/fragment', () => {
    expect(normalizeRoutePath('/Memos?userId=1')).toBe('/memos');
    expect(normalizeRoutePath('/memos#top')).toBe('/memos');
    expect(normalizeRoutePath('memos/')).toBe('/memos');
    expect(normalizeRoutePath('/')).toBe('/');
  });
});

describe('routesOverlap', () => {
  it('matches template vs concrete path with same method', () => {
    expect(routesOverlap({ path: '/memos/:id', method: 'GET' }, { path: '/memos/42', method: 'get' })).toBe(true);
  });
  it('rejects method mismatch', () => {
    expect(routesOverlap({ path: '/memos/:id', method: 'GET' }, { path: '/memos/42', method: 'POST' })).toBe(false);
  });
  it('rejects different literal paths', () => {
    expect(routesOverlap({ path: '/login', method: 'POST' }, { path: '/register', method: 'POST' })).toBe(false);
  });
  it('enforces parameter agreement when both sides specify one', () => {
    expect(
      routesOverlap({ path: '/memos', method: 'GET', parameter: 'userId' }, { path: '/memos', method: 'GET', parameter: 'userid' })
    ).toBe(true);
    expect(
      routesOverlap({ path: '/memos', method: 'GET', parameter: 'userId' }, { path: '/memos', method: 'GET', parameter: 'q' })
    ).toBe(false);
    // corpus hint present, exploit has no parameter info -> still a match
    expect(routesOverlap({ path: '/memos', method: 'GET', parameter: 'userId' }, { path: '/memos', method: 'GET' })).toBe(true);
  });
});

describe('findingMatchesExploit', () => {
  it('matches on type identity + route', () => {
    expect(findingMatchesExploit(NODEGOAT.groundTruth[0]!, exploit({}))).toBe(true);
  });
  it('matches on cwe identity even when types differ in casing', () => {
    expect(
      findingMatchesExploit(NODEGOAT.groundTruth[0]!, exploit({ vulnerabilityType: null, cweId: 'cwe-89' }))
    ).toBe(true);
  });
  it('rejects a different vulnerability on the same route', () => {
    expect(findingMatchesExploit(NODEGOAT.groundTruth[0]!, exploit({ vulnerabilityType: 'XSS', cweId: 'CWE-79' }))).toBe(false);
  });
  it('rejects a confirmed exploit on an unrelated route', () => {
    expect(findingMatchesExploit(NODEGOAT.groundTruth[0]!, exploit({ endpoint: '/other?q=1', parameter: 'q' }))).toBe(false);
  });
});

describe('buildDetectionReport', () => {
  it('scores recall/precision/F1 for sniper scope', () => {
    const report = buildDetectionReport(NODEGOAT, [exploit({})], [vuln({ cweId: 'CWE-79', vulnType: 'XSS' })]);
    expect(report.aggregates.sniper).toEqual({ truePositive: 1, falseNegative: 0, falsePositive: 0, recall: 1, precision: 1, f1: 1 });
    expect(report.aggregates.static.truePositive).toBe(1);
    expect(report.aggregates.futureCount).toBe(1);
    expect(report.findings.find((f) => f.finding.id === 'sqli-memos')?.matchedBy).not.toBeNull();
    expect(report.findings.find((f) => f.finding.id === 'xss-memos')?.matchedBy).not.toBeNull();
  });

  it('counts a missing confirmed exploit as a false negative', () => {
    const report = buildDetectionReport(NODEGOAT, [], []);
    expect(report.aggregates.sniper).toEqual({ truePositive: 0, falseNegative: 1, falsePositive: 0, recall: 0, precision: 0, f1: 0 });
  });

  it('counts confirmed exploits outside the ground truth as false positives', () => {
    const report = buildDetectionReport(
      NODEGOAT,
      [exploit({}), exploit({ id: 'exp-2', endpoint: 'http://x/login?u=1', parameter: 'u', vulnerabilityType: 'SQL_INJECTION', cweId: 'CWE-89' })],
      []
    );
    expect(report.aggregates.sniper).toEqual({ truePositive: 1, falseNegative: 0, falsePositive: 1, recall: 1, precision: 0.5, f1: 0.667 });
    expect(report.falsePositives.map((e) => e.id)).toEqual(['exp-2']);
  });

  it('reports per-CWE F1 only for scored scopes', () => {
    const report = buildDetectionReport(NODEGOAT, [exploit({})], []);
    expect(report.perCwe).toContainEqual({ cweId: 'CWE-89', scope: 'sniper', truePositive: 1, falseNegative: 0, falsePositive: 0, f1: 1 });
    expect(report.perCwe).toContainEqual({ cweId: 'CWE-79', scope: 'static', truePositive: 0, falseNegative: 1, falsePositive: 0, f1: 0 });
    expect(report.perCwe).toHaveLength(2); // future-scoped CWE-639 never scored
  });

  it('does not double-count one exploit against two findings of the same type', () => {
    const app: CorpusApp = {
      ...NODEGOAT,
      groundTruth: [
        NODEGOAT.groundTruth[0]!,
        { id: 'sqli-memos-2', cweId: 'CWE-89', vulnerabilityType: 'SQL_INJECTION', title: 'SQLi #2', scope: 'sniper', routes: [{ path: '/memos', method: 'GET' }] },
      ],
    };
    const report = buildDetectionReport(app, [exploit({})], []);
    // one exploit satisfies both findings (same route) — still one TP row,
    // and the second finding is a FN because the exploit was consumed.
    expect(report.aggregates.sniper.truePositive).toBe(1);
    expect(report.aggregates.sniper.falseNegative).toBe(1);
    expect(report.falsePositives).toHaveLength(0);
  });
});

describe('buildReconReport', () => {
  it('computes surface recall with template matching', () => {
    const report = buildReconReport(NODEGOAT, [
      { url: 'http://172.18.0.3:8080/', method: 'GET' },
      { url: 'http://172.18.0.3:8080/memos', method: 'GET' },
      { url: 'http://172.18.0.3:8080/memos/7', method: 'GET' },
    ]);
    expect(report.recall).toBe(0.75); // /login missing
    expect(report.missing).toEqual(['/login']);
  });
});

describe('parseCorpus / findApp', () => {
  it('parses and validates the shipped corpus document', async () => {
    const raw = JSON.parse(await import('fs').then((fs) => fs.promises.readFile(new URL('../../../benchmarks/corpus.json', import.meta.url), 'utf8')));
    const corpus = parseCorpus(raw);
    expect(corpus.apps.length).toBeGreaterThanOrEqual(2);
    const nodegoat = corpus.apps.find((a) => a.id === 'nodegoat');
    expect(nodegoat?.runtime.startCommand).toEqual(['npm', 'start']);
    expect(nodegoat?.groundTruth.some((f) => f.scope === 'sniper')).toBe(true);
  });

  it('rejects malformed documents with a path-specific error', () => {
    expect(() => parseCorpus({ version: 1, apps: [] })).toThrow(CorpusValidationError);
    expect(() =>
      parseCorpus({
        version: 1,
        apps: [
          {
            id: 'x',
            name: 'x',
            repoUrl: 'u',
            runtime: { strategy: 'nope', port: 1, healthPath: '/' },
            groundTruth: [{ id: 'f', cweId: 'CWE-89', title: 't', scope: 'sniper' }],
          },
        ],
      })
    ).toThrow(/strategy/);
    expect(() =>
      parseCorpus({
        version: 1,
        apps: [
          {
            id: 'X Bad',
            name: 'x',
            repoUrl: 'u',
            runtime: { strategy: 'generated-python', port: 1, healthPath: '/' },
            groundTruth: [{ id: 'f', cweId: 'CWE-89', title: 't', scope: 'sniper' }],
          },
        ],
      })
    ).toThrow(/app id/);
  });

  it('findApp joins by normalized repo url and falls back to scan name', () => {
    const corpus = parseCorpus({ version: 1, apps: [NODEGOAT] });
    expect(findApp(corpus, 'https://github.com/OWASP/NodeGoat', null)?.id).toBe('nodegoat');
    expect(findApp(corpus, 'https://GITHUB.com/owasp/nodegoat.git', null)?.id).toBe('nodegoat');
    expect(findApp(corpus, null, 'scan-nodegoat-2025')?.id).toBe('nodegoat');
    expect(findApp(corpus, 'https://example.org/other.git', null)).toBeNull();
    expect(normalizeRepoUrl('https://github.com/OWASP/NodeGoat.git/')).toBe('https://github.com/owasp/nodegoat');
  });
});
