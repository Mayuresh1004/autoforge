import { describe, expect, it } from 'vitest';
import { parseSqlMapOutput } from './sqlmap-output-parser';
import {
  SQLMAP_CONNECTION_ERROR,
  SQLMAP_NOT_INJECTABLE,
  SQLMAP_TOOL_CRASH,
  SQLMAP_VULNERABLE,
  SQLMAP_VULNERABLE_POST,
} from '../../../../../test/helpers/sniper-fixtures';

/** sqlmap adapter output parsing — turning tool text into signals. */
describe('parseSqlMapOutput', () => {
  it('extracts a confirmed injection point (parameter, techniques, payloads)', () => {
    const out = parseSqlMapOutput(SQLMAP_VULNERABLE, '');
    expect(out.vulnerable).toBe(true);
    expect(out.parameter).toBe('q');
    expect(out.method).toBe('GET');
    expect(out.techniques).toContain('boolean-based blind');
    expect(out.techniques).toContain('time-based blind');
    expect(out.techniques).toContain('UNION query');
    expect(out.payloadCount).toBeGreaterThan(0);
    expect(out.dbms).toBe('sqlite');
    expect(out.noInjection).toBe(false);
    expect(out.reached).toBe(true);
  });

  it('parses a clear no-injection verdict', () => {
    const out = parseSqlMapOutput(SQLMAP_NOT_INJECTABLE, '');
    expect(out.vulnerable).toBe(false);
    expect(out.noInjection).toBe(true);
    expect(out.connectionError).toBe(false);
    expect(out.toolError).toBe(false);
    expect(out.reached).toBe(true);
  });

  it('flags a connection-level failure (not a verdict)', () => {
    const out = parseSqlMapOutput(SQLMAP_CONNECTION_ERROR, '');
    expect(out.vulnerable).toBe(false);
    expect(out.noInjection).toBe(false);
    expect(out.connectionError).toBe(true);
  });

  it('flags a tool crash', () => {
    const out = parseSqlMapOutput(SQLMAP_TOOL_CRASH, '');
    expect(out.toolError).toBe(true);
    expect(out.vulnerable).toBe(false);
    expect(out.reached).toBe(false);
  });

  it('extracts POST bound injection points', () => {
    const out = parseSqlMapOutput(SQLMAP_VULNERABLE_POST, '');
    expect(out.vulnerable).toBe(true);
    expect(out.method).toBe('POST');
    expect(out.dbms).toBe('mariadb');
  });

  it('parses HTTP 401/403 and login redirects as authRequired', () => {
    const out401 = parseSqlMapOutput('[CRITICAL] http error code 401 (Unauthorized)', '');
    expect(out401.authRequired).toBe(true);
    expect(out401.toolError).toBe(false);
    expect(out401.noInjection).toBe(false);

    const out403 = parseSqlMapOutput('[WARNING] HTTP error code 403 (Forbidden)', '');
    expect(out403.authRequired).toBe(true);
    expect(out403.toolError).toBe(false);

    const outRedirect = parseSqlMapOutput("[WARNING] got a 302 redirect to 'http://127.0.0.1:8080/login'", '');
    expect(outRedirect.authRequired).toBe(true);
    expect(outRedirect.toolError).toBe(false);
    expect(outRedirect.noInjection).toBe(false);
  });

  it('parses output with no GET/POST parameters as noParameters without toolError', () => {
    const out = parseSqlMapOutput(
      "[WARNING] you've provided target URL without any GET parameters\n[CRITICAL] no parameter(s) found for testing",
      ''
    );
    expect(out.noParameters).toBe(true);
    expect(out.toolError).toBe(false);
    expect(out.vulnerable).toBe(false);
  });
});
