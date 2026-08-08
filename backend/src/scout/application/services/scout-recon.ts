import { randomUUID } from 'node:crypto';
import { classifyEndpoint } from '../../domain/classification';
import type {
  AttackSurfaceEntry,
  DetectedTechnology,
  DiscoveredService,
  Endpoint,
  OpenPort,
} from '../../domain/models/attack-surface';
import {
  EMPTY_ROBOTS,
  type RobotsDirectives,
} from '../../domain/ports/robots-parser';
import type { ScoutToolRuntime } from '../../domain/ports/scout-tool-runtime';
import type { CrawledPage, Crawler } from '../../domain/ports/crawler';
import type { RobotsParser } from '../../domain/ports/robots-parser';
import type { TechnologyFingerprinter } from '../../domain/ports/tech-fingerprinter';
import type { PortScanner } from '../../domain/ports/port-scanner';
import type {
  DiscoveryResult,
  EndpointDiscoverer,
} from '../../domain/ports/endpoint-discoverer';
import type { AttackSurfacePrioritizer } from './attack-surface-prioritizer';
import type { RunScoutOptions } from '../../domain/ports/scout-service';
import type { ScoutConfig } from '../../../config';
import { stripHtml } from '../../infrastructure/tools/html';

export interface ResolvedScoutOptions {
  readonly timeoutMs: number;
  readonly maxPages: number;
  readonly maxDepth: number;
  readonly probeTimeoutMs: number;
  readonly probeCommonPaths: boolean;
  readonly portScan: boolean;
  readonly maxPageBytes: number;
  readonly portScanTimeoutMs: number;
}

export function resolveOptions(
  config: ScoutConfig,
  input: { readonly options?: RunScoutOptions },
): ResolvedScoutOptions {
  const o = input.options ?? {};
  return {
    timeoutMs: o.timeoutMs ?? config.timeoutMs,
    maxPages: o.maxPages ?? config.maxPages,
    maxDepth: o.maxDepth ?? config.maxDepth,
    probeTimeoutMs: config.probeTimeoutMs,
    probeCommonPaths: o.probeCommonPaths ?? config.probeCommonPaths,
    portScan: o.portScan ?? config.portScanEnabled,
    maxPageBytes: 256 * 1024,
    portScanTimeoutMs: 90_000,
  };
}

/** The recon-tool dep subset (persistence stays with the orchestrator). */
export interface ScoutReconDeps {
  readonly runtime: ScoutToolRuntime;
  readonly crawler: Crawler;
  readonly robotsParser: RobotsParser;
  readonly fingerprinter: TechnologyFingerprinter;
  readonly portScanner: PortScanner;
  readonly endpointDiscoverer: EndpointDiscoverer;
  readonly prioritizer: AttackSurfacePrioritizer;
}

const errorOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Individual recon phases. Each is guarded: a throwing phase returns a default
 * and records the error, so a single tool failure never aborts the run.
 */
export class ScoutRecon {
  constructor(private readonly deps: ScoutReconDeps) {}

  probe(url: string, options: import('../../domain/ports/scout-tool-runtime').HttpProbeOptions = {}) {
    return this.deps.runtime.probe(url, options);
  }

  async crawl(
    targetUrl: string,
    opts: ResolvedScoutOptions,
    errors: string[],
  ): Promise<readonly CrawledPage[]> {
    try {
      const result = await this.deps.crawler.crawl(targetUrl, {
        maxPages: opts.maxPages,
        maxDepth: opts.maxDepth,
        probe: { timeoutMs: opts.probeTimeoutMs, maxBodyBytes: opts.maxPageBytes },
      });
      errors.push(...result.errors.map((e) => `crawl: ${e}`));
      return result.pages;
    } catch (err) {
      errors.push(`crawl: ${errorOf(err)}`);
      return [];
    }
  }

  async robots(
    targetUrl: string,
    opts: ResolvedScoutOptions,
    errors: string[],
  ): Promise<RobotsDirectives> {
    try {
      const probe = await this.deps.runtime.probe(`${targetUrl}/robots.txt`, {
        timeoutMs: opts.probeTimeoutMs,
      });
      if (probe.ok && probe.body.trim().length > 0) return this.deps.robotsParser.parse(probe.body);
    } catch (err) {
      errors.push(`robots: ${errorOf(err)}`);
    }
    return EMPTY_ROBOTS;
  }

  async fingerprint(
    targetUrl: string,
    pages: readonly CrawledPage[],
    opts: ResolvedScoutOptions,
    errors: string[],
  ): Promise<readonly DetectedTechnology[]> {
    const urls = [...new Set([targetUrl, ...pages.map((p) => p.url)])].slice(0, 6);
    const out: DetectedTechnology[] = [];
    for (const url of urls) {
      const page = pages.find((p) => p.url === url);
      try {
        out.push(
          ...(await this.deps.fingerprinter.fingerprint({
            url,
            statusCode: page?.statusCode ?? null,
            headers: page?.headers ?? {},
            bodyText: stripHtml(page?.html ?? ''),
          })),
        );
      } catch (err) {
        errors.push(`fingerprint(${url}): ${errorOf(err)}`);
      }
    }
    return dedupeTech(out);
  }

  async scanPorts(
    host: string,
    opts: ResolvedScoutOptions,
    errors: string[],
  ): Promise<{ ports: readonly OpenPort[]; services: readonly DiscoveredService[] }> {
    if (!opts.portScan) return { ports: [], services: [] };
    try {
      const ports = await this.deps.portScanner.scan(host, {
        timeoutMs: opts.portScanTimeoutMs,
        scope: 'top-1000',
      });
      const services = ports
        .filter((p) => p.service)
        .map(
          (p): DiscoveredService => ({
            name: p.service as string,
            protocol: p.protocol,
            port: p.port,
            version: null,
            evidence: `port ${p.port}/${p.protocol}`,
          }),
        );
      return { ports, services };
    } catch (err) {
      errors.push(`portscan: ${errorOf(err)}`);
      return { ports: [], services: [] };
    }
  }

  async discover(
    baseUrl: string,
    pages: readonly CrawledPage[],
    robots: RobotsDirectives,
    opts: ResolvedScoutOptions,
    errors: string[],
  ): Promise<DiscoveryResult> {
    try {
      return await this.deps.endpointDiscoverer.discover({
        baseUrl,
        pages,
        robots,
        options: { timeoutMs: opts.probeTimeoutMs, probeCommonPaths: opts.probeCommonPaths },
      });
    } catch (err) {
      errors.push(`discover: ${errorOf(err)}`);
      return { endpoints: [], forms: [], graphql: false, websockets: [] };
    }
  }

  prioritize(
    endpoints: readonly Endpoint[],
    technologies: readonly DetectedTechnology[],
  ): readonly AttackSurfaceEntry[] {
    const techNames = technologies.map((t) => t.name);
    return endpoints.map((endpoint) => ({
      id: randomUUID(),
      url: endpoint.url,
      method: endpoint.method,
      parameters: endpoint.parameters,
      authentication: endpoint.authentication,
      technology: techNames,
      risk: this.deps.prioritizer.assignRisk(
        classifyEndpoint(
          endpoint.url,
          endpoint.method,
          endpoint.statusCode,
          undefined,
          endpoint.parameters.length,
        ),
      ),
      source: endpoint.source,
      reachable: endpoint.statusCode !== null && endpoint.statusCode < 500,
      statusCode: endpoint.statusCode,
    }));
  }
}

function dedupeTech(items: readonly DetectedTechnology[]): readonly DetectedTechnology[] {
  const map = new Map<string, DetectedTechnology>();
  for (const item of items) {
    const existing = map.get(item.name);
    if (!existing || item.confidence > existing.confidence) map.set(item.name, item);
  }
  return [...map.values()];
}