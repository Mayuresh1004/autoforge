import { describe, expect, it } from 'vitest';
import { SignatureTechnologyFingerprinter } from './signature-technology-fingerprinter';

describe('SignatureTechnologyFingerprinter', () => {
  const fp = new SignatureTechnologyFingerprinter();

  it('detects nginx from the server header', async () => {
    const tech = await fp.fingerprint({
      url: 'http://x/',
      statusCode: 200,
      headers: { server: 'nginx/1.25.1' },
      bodyText: '<html></html>',
    });
    expect(tech.some((t) => t.name === 'nginx')).toBe(true);
  });

  it('detects Express from x-powered-by', async () => {
    const tech = await fp.fingerprint({
      url: 'http://x/',
      statusCode: 200,
      headers: { 'x-powered-by': 'Express' },
      bodyText: '',
    });
    expect(tech.some((t) => t.name === 'Express')).toBe(true);
  });

  it('detects React/Next from body marker', async () => {
    const tech = await fp.fingerprint({
      url: 'http://x/',
      statusCode: 200,
      headers: {},
      bodyText: 'window.__NEXT_DATA__ = {}',
    });
    expect(tech.some((t) => t.name === 'Next.js' || t.name === 'React')).toBe(true);
  });

  it('detects WordPress from generator meta in body', async () => {
    const tech = await fp.fingerprint({
      url: 'http://x/',
      statusCode: 200,
      headers: {},
      bodyText: '<meta name="generator" content="WordPress 6.2">',
    });
    expect(tech.some((t) => t.name === 'WordPress')).toBe(true);
  });

  it('returns empty when nothing matches', async () => {
    const tech = await fp.fingerprint({
      url: 'http://x/',
      statusCode: 200,
      headers: {},
      bodyText: 'opaque text with no markers',
    });
    expect(tech).toEqual([]);
  });
});