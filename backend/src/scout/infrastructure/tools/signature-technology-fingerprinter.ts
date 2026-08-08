import type { DetectedTechnology } from '../../domain/models/attack-surface';
import type { FingerprintSource, TechnologyFingerprinter } from '../../domain/ports/tech-fingerprinter';

interface Signature {
  readonly name: string;
  readonly category: string;
  readonly confidence: number;
  readonly headers?: ReadonlyArray<{ name: string; pattern: RegExp; versionGroup?: number }>;
  readonly body?: ReadonlyArray<{ pattern: RegExp; versionGroup?: number }>;
}

/** Compact signature set (fingerprint-grade, not exhaustive Wappalyzer data).
 * Detects common server / framework / CMS markers from headers and page text.
 */
const SIGNATURES: Signature[] = [
  {
    name: 'nginx',
    category: 'web-server',
    confidence: 0.9,
    headers: [{ name: 'server', pattern: /^nginx/i }],
  },
  {
    name: 'Apache',
    category: 'web-server',
    confidence: 0.9,
    headers: [{ name: 'server', pattern: /^Apache/i }],
  },
  {
    name: 'Microsoft-IIS',
    category: 'web-server',
    confidence: 0.9,
    headers: [{ name: 'server', pattern: /^Microsoft-IIS/i }],
  },
  {
    name: 'Express',
    category: 'web-framework',
    confidence: 0.9,
    headers: [{ name: 'x-powered-by', pattern: /Express/i }],
  },
  {
    name: 'PHP',
    category: 'language',
    confidence: 0.9,
    headers: [{ name: 'x-powered-by', pattern: /PHP/i }],
  },
  {
    name: 'Next.js',
    category: 'web-framework',
    confidence: 0.8,
    headers: [{ name: 'x-powered-by', pattern: /Next\.js/i }],
    body: [{ pattern: /__NEXT_DATA__/ }],
  },
  {
    name: 'Gatsby',
    category: 'static-site-generator',
    confidence: 0.7,
    body: [{ pattern: /gatsby/i }],
  },
  {
    name: 'WordPress',
    category: 'cms',
    confidence: 0.9,
    body: [{ pattern: /wp-content|wp-json|generator[^>]*wordpress/i }],
  },
  {
    name: 'Django',
    category: 'web-framework',
    confidence: 0.75,
    body: [{ pattern: /csrfmiddlewaretoken/i }],
  },
  {
    name: 'Rails',
    category: 'web-framework',
    confidence: 0.7,
    body: [{ pattern: /csrf-param|csrf-token|data-remote|rails/i }],
  },
  {
    name: 'React',
    category: 'javascript-framework',
    confidence: 0.7,
    body: [{ pattern: /data-reactroot|__NEXT_DATA__/ }],
  },
  {
    name: 'Vue',
    category: 'javascript-framework',
    confidence: 0.7,
    body: [{ pattern: /data-v-[a-f0-9]+|__vue__|vue\.js/i }],
  },
  {
    name: 'Angular',
    category: 'javascript-framework',
    confidence: 0.7,
    body: [{ pattern: /ng-app|ng-version|\bnx-app\b/i }],
  },
  {
    name: 'jQuery',
    category: 'javascript-library',
    confidence: 0.7,
    body: [{ pattern: /jquery(\.min)?\.js/i }],
  },
  {
    name: 'Bootstrap',
    category: 'css-framework',
    confidence: 0.7,
    body: [{ pattern: /bootstrap(\.min)?\.(css|js)/i }],
  },
  {
    name: 'Tailwind CSS',
    category: 'css-framework',
    confidence: 0.7,
    body: [{ pattern: /tailwindcss|class=["'][^"']*\b(flex|grid|p-\d)/i }],
  },
  {
    name: 'Spring Boot',
    category: 'web-framework',
    confidence: 0.7,
    body: [{ pattern: /whitelabel error|spring|etag/i }],
  },
  {
    name: 'Laravel',
    category: 'web-framework',
    confidence: 0.7,
    headers: [{ name: 'set-cookie', pattern: /laravel_session/i }],
  },
];

/**
 * Signature-based technology fingerprinting from response headers + page text.
 * Works headless (no binary) and degrades to zero findings when nothing matches.
 */
export class SignatureTechnologyFingerprinter implements TechnologyFingerprinter {
  async fingerprint(source: FingerprintSource): Promise<DetectedTechnology[]> {
    const headers = lowercaseHeaders(source.headers);
    const found: DetectedTechnology[] = [];

    for (const signature of SIGNATURES) {
      let evidence = '';
      let version: string | null = null;

      for (const h of signature.headers ?? []) {
        const value = headers[h.name.toLowerCase()];
        if (value && h.pattern.test(value)) {
          evidence = `${h.name}: ${value.slice(0, 80)}`;
          if (typeof h.versionGroup === 'number') {
            const m = h.pattern.exec(value);
            version = m?.[h.versionGroup] ?? null;
          }
          break;
        }
      }

      if (!evidence) {
        for (const b of signature.body ?? []) {
          const m = b.pattern.exec(source.bodyText);
          if (m) {
            evidence = `body: ${b.pattern}`;
            if (typeof b.versionGroup === 'number') version = m[b.versionGroup] ?? null;
            break;
          }
        }
      }

      if (evidence) {
        found.push({
          name: signature.name,
          category: signature.category,
          version,
          confidence: signature.confidence,
          evidence,
        });
      }
    }
    return found;
  }
}

function lowercaseHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}