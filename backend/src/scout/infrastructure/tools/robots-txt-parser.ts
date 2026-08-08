import type { RobotsDirectives, RobotsParser } from '../../domain/ports/robots-parser';

/**
 * Parses robots.txt text into directives. Pure text processing, no network.
 * Disallowed paths / sitemaps become candidate surface for the discoverer.
 */
export class RobotsTxtParser implements RobotsParser {
  parse(raw: string): RobotsDirectives {
    const userAgents: string[] = [];
    const allowed: string[] = [];
    const disallowed: string[] = [];
    const sitemaps: string[] = [];

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf(':');
      if (idx === -1) continue;
      const field = trimmed.slice(0, idx).trim().toLowerCase();
      const value = trimmed.slice(idx + 1).trim();

      if (field === 'user-agent') {
        userAgents.push(value);
      } else if (field === 'allow') {
        allowed.push(value);
      } else if (field === 'disallow') {
        disallowed.push(value);
      } else if (field === 'sitemap') {
        sitemaps.push(value);
      }
    }

    return { userAgents, allowed, disallowed, sitemaps };
  }
}