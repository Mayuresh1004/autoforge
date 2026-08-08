import { describe, expect, it } from 'vitest';
import { RobotsTxtParser } from './robots-txt-parser';

describe('RobotsTxtParser', () => {
  const parser = new RobotsTxtParser();

  it('parses user-agent, disallow, allow and sitemap lines', () => {
    const raw = [
      'User-agent: *',
      'Disallow: /admin',
      'Disallow: /private/',
      'Allow: /public',
      'Sitemap: https://example.com/sitemap.xml',
      '',
      'User-agent: Googlebot',
      'Disallow: /no-index',
    ].join('\n');

    const parsed = parser.parse(raw);
    expect(parsed.userAgents).toEqual(['*', 'Googlebot']);
    expect(parsed.disallowed).toEqual(['/admin', '/private/', '/no-index']);
    expect(parsed.allowed).toEqual(['/public']);
    expect(parsed.sitemaps).toEqual(['https://example.com/sitemap.xml']);
  });

  it('ignores comments and blank lines', () => {
    const parsed = parser.parse('# comment\n\nUser-agent: *\n# another\nDisallow: /tmp');
    expect(parsed.userAgents).toEqual(['*']);
    expect(parsed.disallowed).toEqual(['/tmp']);
  });

  it('handles case-insensitive field names', () => {
    const parsed = parser.parse('USER-AGENT: Bot\nSITEMAP: http://x/s.xml');
    expect(parsed.userAgents).toEqual(['Bot']);
    expect(parsed.sitemaps).toEqual(['http://x/s.xml']);
  });

  it('returns empty directives for garbage input', () => {
    const parsed = parser.parse('this is not robots');
    expect(parsed).toEqual({ userAgents: [], allowed: [], disallowed: [], sitemaps: [] });
  });
});