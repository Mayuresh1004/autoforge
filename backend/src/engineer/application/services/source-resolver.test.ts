import { describe, expect, it } from 'vitest';
import { parseEndpointPath, scoreCandidateFile, SourceResolver } from './source-resolver';
import { confirmedFinding } from '../../../../test/helpers/engineer-fakes';

describe('SourceResolver', () => {
  const resolver = new SourceResolver();

  it('parses endpoint paths correctly', () => {
    expect(parseEndpointPath('http://172.23.0.2:3000/api/products/search?q=')).toBe('/api/products/search');
    expect(parseEndpointPath('/api/users')).toBe('/api/users');
    expect(parseEndpointPath('http://localhost:8080/search')).toBe('/search');
  });

  it('resolves direct filePath when finding has a valid filePath', async () => {
    const finding = confirmedFinding({
      filePath: 'src/routes/search.ts',
    });
    const result = await resolver.resolve(finding, null, null);
    expect(result).not.toBeNull();
    expect(result?.filePath).toBe('src/routes/search.ts');
    expect(result?.resolutionMethod).toBe('DIRECT_FILE');
    expect(result?.confidence).toBe(1.0);
  });

  it('resolves dynamic endpoint from fileContents when finding.filePath is null', async () => {
    const finding = confirmedFinding({
      vulnerabilityId: 'dyn-1',
      filePath: null,
      endpoint: 'http://172.23.0.2:3000/api/products/search?q=',
      method: 'GET',
      parameter: 'q',
    });

    const fileContents = {
      'src/routes/products.ts': `
        import { Router } from 'express';
        const router = Router();
        router.get('/api/products/search', (req, res) => {
          const q = req.query.q;
          db.query("SELECT * FROM products WHERE name = '" + q + "'");
        });
      `,
      'src/routes/users.ts': `
        import { Router } from 'express';
        const router = Router();
        router.get('/api/users', (req, res) => {
          res.json([]);
        });
      `,
    };

    const result = await resolver.resolve(finding, null, null, undefined, fileContents);
    expect(result).not.toBeNull();
    expect(result?.filePath).toBe('src/routes/products.ts');
    expect(result?.resolutionMethod).toBe('ENDPOINT_SEARCH');
    expect(result?.candidateCount).toBe(1);
    expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('returns null (REJECTED) when endpoint matches multiple ambiguous candidates equally', async () => {
    const finding = confirmedFinding({
      vulnerabilityId: 'dyn-ambiguous',
      filePath: null,
      endpoint: 'http://172.23.0.2:3000/api/search?q=',
      method: 'GET',
      parameter: 'q',
    });

    const fileContents = {
      'src/searchA.ts': `router.get('/api/search', (req, res) => { const q = req.query.q; db.query(q); });`,
      'src/searchB.ts': `router.get('/api/search', (req, res) => { const q = req.query.q; db.query(q); });`,
    };

    const result = await resolver.resolve(finding, null, null, undefined, fileContents);
    expect(result).toBeNull();
  });

  it('returns null when endpoint cannot be found in any candidate file', async () => {
    const finding = confirmedFinding({
      vulnerabilityId: 'dyn-missing',
      filePath: null,
      endpoint: 'http://172.23.0.2:3000/api/nonexistent?id=',
      method: 'GET',
      parameter: 'id',
    });

    const fileContents = {
      'src/app.ts': `console.log("hello world");`,
    };

    const result = await resolver.resolve(finding, null, null, undefined, fileContents);
    expect(result).toBeNull();
  });
});
