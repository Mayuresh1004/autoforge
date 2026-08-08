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
  });});
