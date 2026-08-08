import { describe, expect, it } from 'vitest';
import { classifyEndpoint } from '../../domain/classification';
import { HeuristicAttackSurfacePrioritizer } from '../../application/services/attack-surface-prioritizer';

const prioritizer = new HeuristicAttackSurfacePrioritizer();
const risk = (url: string, method: string, status: number | null, html = '', params = 0) =>
  prioritizer.assignRisk(classifyEndpoint(url, method, status, html, params));

describe('HeuristicAttackSurfacePrioritizer', () => {
  it('authenticated upload is CRITICAL', () => {
    expect(risk('http://x/upload', 'POST', 401, '<form enctype="multipart/form-data">')).toBe('CRITICAL');
  });

  it('public upload is HIGH', () => {
    expect(risk('http://x/upload', 'POST', 200)).toBe('HIGH');
  });

  it('admin panel is HIGH', () => {
    expect(risk('http://x/admin', 'GET', 200)).toBe('HIGH');
  });

  it('public health endpoint is LOW', () => {
    expect(risk('http://x/health', 'GET', 200)).toBe('LOW');
  });

  it('public static image is LOW', () => {
    expect(risk('http://x/public/logo.png', 'GET', 200)).toBe('LOW');
  });

  it('public api with params is MEDIUM', () => {
    expect(risk('http://x/api/search', 'POST', 200, '', 1)).toBe('MEDIUM');
  });

  it('api with params and 401 is HIGH (api+auth params)', () => {
    expect(risk('http://x/api/users?q=1', 'POST', 401, '', 1)).toBe('HIGH');
  });

  it('docs page is LOW', () => {
    expect(risk('http://x/docs', 'GET', 200)).toBe('LOW');
  });

  it('login page is MEDIUM', () => {
    expect(risk('http://x/login', 'GET', 200, '<input name="password" type="password">')).toBe('MEDIUM');
  });

  it('marks 401/403 as requiring authentication', () => {
    const signals = classifyEndpoint('http://x/admin', 'GET', 403);
    expect(signals.authentication).toBe(true);
  });

  it('normalizes query params into path for classification', () => {
    const signals = classifyEndpoint('http://x/api/search?q=a', 'GET', 200);
    expect(signals.isApi).toBe(true);
    expect(signals.hasParameters).toBe(true);
  });
});