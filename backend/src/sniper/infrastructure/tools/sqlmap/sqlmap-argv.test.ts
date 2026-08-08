import { describe, expect, it } from 'vitest';
import { buildSqlMapArgv } from './sqlmap-argv';

/** SQLMap adapter argument construction — controlled, argv-only, bounded. */
describe('buildSqlMapArgv', () => {
  it('tests GET query parameters inside the URL', () => {
    const { argv, probeUrl, data } = buildSqlMapArgv({
      url: 'http://app:3000/api/search?q=test&type=book',
      method: 'GET',
      timeoutMs: 60_000,
    });
    expect(probeUrl).toContain('q=test');
    expect(data).toBeUndefined();
    expect(argv[0]).toBe('sqlmap');
    expect(argv).toContain('--url');
  });

  it('moves GET params into --data for POST and strips the query from the URL', () => {
    const { argv, probeUrl, data } = buildSqlMapArgv({
      url: 'http://app:3000/api/search?q=test',
      method: 'POST',
      timeoutMs: 60_000,
    });
    expect(probeUrl).toBe('http://app:3000/api/search');
    expect(data).toBe('q=test');
    expect(argv).toContain('--data');
  });

  it('never enables state-changing sqlmap features', () => {
    const { argv } = buildSqlMapArgv({
      url: 'http://app:3000/api/search?q=1',
      method: 'GET',
      timeoutMs: 120_000,
    });
    const joined = argv.join(' ');
    expect(joined).not.toMatch(/--dump|--os-shell|--file-|--tamper|--sql-(shell|query)/i);
    expect(joined).not.toMatch(/\$|;|&&|\|\|/);
  });

  it('bounds the run: timeout seconds, retries, threads, level/risk caps', () => {
    const { argv } = buildSqlMapArgv({
      url: 'http://app:3000/?id=1',
      method: 'GET',
      timeoutMs: 5_000,
      level: 9,
      risk: 9,
      retries: 99,
    });
    expect(argv).toContain('--threads');
    expect(argv[argv.indexOf('--threads') + 1]).toBe('1');
    expect(argv[argv.indexOf('--timeout') + 1]).toBe('5');
    // It still clamps to the safe domain.
    expect(argv[argv.indexOf('--retries') + 1]).toBe('3');
    expect(argv[argv.indexOf('--level') + 1]).toBe('5');
    expect(argv[argv.indexOf('--risk') + 1]).toBe('3');
    expect(argv).toContain('--batch');
  });

  it('injects explicit credentials only when provided', () => {
    const plain = buildSqlMapArgv({ url: 'http://a/?id=1', method: 'GET', timeoutMs: 1000 });
    expect(plain.argv).not.toContain('--cookie');
    const authed = buildSqlMapArgv({
      url: 'http://a/?id=1',
      method: 'GET',
      timeoutMs: 1000,
      cookie: 'session=abc123',
    });
    expect(authed.argv[authed.argv.indexOf('--cookie') + 1]).toBe('session=abc123');
  });});
