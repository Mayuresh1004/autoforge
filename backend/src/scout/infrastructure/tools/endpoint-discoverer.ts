import type { Endpoint, HttpMethod } from '../../domain/models/attack-surface';
import { classifyEndpoint } from '../../domain/classification';
import type { ScoutToolRuntime } from '../../domain/ports/scout-tool-runtime';
import type { CrawledPage } from '../../domain/ports/crawler';
import type { RobotsDirectives } from '../../domain/ports/robots-parser';
import type {
  DiscoveredForm,
  DiscoveryOptions,
  DiscoveryResult,
  EndpointDiscoverer,
} from '../../domain/ports/endpoint-discoverer';
import { extractForms, extractHrefs, extractWebsocketHints } from './html';

const COMMON_PATHS = [
  '/admin', '/administrator', '/login', '/signin', '/register',
  '/upload', '/uploads', '/search', '/api', '/api/v1',
  '/health', '/status', '/docs', '/wp-admin', '/phpmyadmin',
];
const GRAPHQL_PATHS = ['/graphql', '/api/graphql', '/v1/graphql', '/query'];
const DOCS_PATHS = ['/openapi.json', '/swagger-ui', '/api-docs', '/redoc'];
const WS_PATHS = ['/ws', '/websocket', '/socket.io'];

const GRAPHQL_HINT = /graphql|must provide operation|query string|"errors"\s*:/i;

/**
 * Discovers endpoints from crawled pages (links + forms), robots hints and
 * well-known path probes; detects REST/GraphQL/WebSocket/API-docs signals.
 * Every probe is idle and bounded — no payloads are emitted, target is read-only.
 */
export class ScoutEndpointDiscoverer implements EndpointDiscoverer {
  constructor(private readonly runtime: ScoutToolRuntime) {}

  async discover(input: {
    readonly baseUrl: string;
    readonly pages: readonly CrawledPage[];
    readonly robots: RobotsDirectives;
    readonly options: DiscoveryOptions;
  }): Promise<DiscoveryResult> {
    const endpoints = new Map<string, Endpoint>();
    const forms: DiscoveredForm[] = [];
    const websockets: Endpoint[] = [];

    // 1. Crawled pages <- GET endpoints.
    for (const page of input.pages) {
      this.add(endpoints, {
        url: page.url,
        method: 'GET',
        parameters: [],
        authentication: page.statusCode === 401 || page.statusCode === 403,
        source: 'crawler',
        statusCode: page.statusCode,
      });

      for (const href of extractHrefs(page.html)) {
        const url = resolveHref(href, page.url);
        if (!url) continue;
        this.add(endpoints, {
          url,
          method: 'GET',
          parameters: paramNames(url),
          authentication: false,
          source: 'link',
          statusCode: null,
        });
      }

      // 2. Forms + input parameters.
      for (const form of extractForms(page.html)) {
        const targetUrl = form.action ? resolveHref(form.action, page.url) : null;
        const url = targetUrl ?? page.url;
        const signals = classifyEndpoint(url, form.method, page.statusCode);
        forms.push({
          url: targetUrl === null ? `${form.action || page.url}` : url,
          method: form.method,
          action: form.action,
          inputs: form.inputs,
          authentication: signals.authentication,
        });
        this.add(endpoints, {
          url,
          method: form.method,
          parameters: form.inputs,
          authentication: signals.authentication,
          source: 'form',
          statusCode: page.statusCode,
        });
      }
    }

    // 3. robots.txt disallowed/sitemap hints -> probe reachability.
    if (input.options.probeCommonPaths) {
      for (const hint of [...input.robots.disallowed, ...input.robots.sitemaps]) {
        const path = hint.startsWith('http') ? hint : toPath(hint);
        if (!path || path === '/' || path.startsWith('*')) continue;
        const url = toUrl(path, input.baseUrl);
        const probe = await this.runtime.probe(url, { timeoutMs: input.options.timeoutMs });
        this.add(endpoints, {
          url: probe.finalUrl || url,
          method: 'GET',
          parameters: paramNames(url),
          authentication: probe.statusCode === 401 || probe.statusCode === 403,
          source: 'robots',
          statusCode: probe.statusCode,
        });
      }
    }

    // 4. Common path probes.
    if (input.options.probeCommonPaths) {
      for (const path of COMMON_PATHS) {
        const url = toUrl(path, input.baseUrl);
        const probe = await this.runtime.probe(url, { timeoutMs: input.options.timeoutMs });
        this.add(endpoints, {
          url: probe.finalUrl || url,
          method: 'GET',
          parameters: [],
          authentication: probe.statusCode === 401 || probe.statusCode === 403,
          source: 'common-path',
          statusCode: probe.statusCode,
        });
      }
    }

    // 5. GraphQL + API docs.
    let graphql = false;
    for (const path of GRAPHQL_PATHS) {
      const url = toUrl(path, input.baseUrl);
      const probe = await this.runtime.probe(url, { timeoutMs: input.options.timeoutMs });
      if (GRAPHQL_HINT.test(probe.body)) graphql = true;
      this.add(endpoints, {
        url: probe.finalUrl || url,
        method: 'GET',
        parameters: [],
        authentication: probe.statusCode === 401 || probe.statusCode === 403,
        source: 'graphql',
        statusCode: probe.statusCode,
      });
    }
    for (const path of DOCS_PATHS) {
      const url = toUrl(path, input.baseUrl);
      const probe = await this.runtime.probe(url, { timeoutMs: input.options.timeoutMs });
      if (probe.statusCode !== null && probe.statusCode < 400) {
        this.add(endpoints, {
          url: probe.finalUrl || url,
          method: 'GET',
          parameters: [],
          authentication: false,
          source: 'docs',
          statusCode: probe.statusCode,
        });
      }
    }

    // 6. WebSocket hints (page content + common WS paths).
    const seenWs = new Set<string>();
    for (const page of input.pages) {
      for (const hint of extractWebsocketHints(page.html)) {
        const url = hint.startsWith('ws')
          ? hint.replace(/^ws/, 'http')
          : toUrl(hint.replace(/^[a-z]+:/, ''), input.baseUrl);
        if (!url || seenWs.has(url)) continue;
        seenWs.add(url);
        websockets.push({
          url,
          method: 'GET',
          parameters: [],
          authentication: false,
          source: 'websocket',
          statusCode: page.statusCode,
        });
      }
    }
    for (const path of WS_PATHS) {
      const url = toUrl(path, input.baseUrl);
      if (seenWs.has(url)) continue;
      seenWs.add(url);
      websockets.push({
        url,
        method: 'GET',
        parameters: [],
        authentication: false,
        source: 'websocket',
        statusCode: null,
      });
    }

    return {
      endpoints: [...endpoints.values()],
      forms,
      graphql,
      websockets,
    };
  }

  private add(endpoints: Map<string, Endpoint>, endpoint: Endpoint): void {
    const key = `${endpoint.method} ${endpoint.url}`;
    const existing = endpoints.get(key);
    if (existing && (existing.statusCode !== null || endpoint.statusCode === null)) return;
    endpoints.set(key, endpoint);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function resolveHref(href: string, base: string): string | null {
  try {
    const resolved = new URL(href, base);
    if (resolved.hash) resolved.hash = '';
    return resolved.href;
  } catch {
    return null;
  }
}

function toUrl(path: string, base: string): string {
  return new URL(path, base).href;
}

/** Convert a robots path hint into a path, or null when unusable. */
function toPath(hint: string): string | null {
  const h = hint.trim();
  if (h.length === 0) return null;
  if (h.startsWith('/')) return h;
  if (/^[a-z]+$/i.test(h)) return null; // bare token like 'http'
  return `/${h.replace(/^\.?\//, '')}`;
}

function paramNames(url: string): string[] {
  try {
    const seen = new Set<string>();
    for (const [key] of new URL(url).searchParams) seen.add(key);
    // also surface common GET form-style query keys when no query present
    return [...seen];
  } catch {
    return [];
  }
}