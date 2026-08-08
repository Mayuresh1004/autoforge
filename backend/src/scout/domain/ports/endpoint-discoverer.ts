import type { Endpoint } from '../models/attack-surface';
import type { CrawledPage } from './crawler';
import type { RobotsDirectives } from './robots-parser';

/** A form discovered on a crawled page (inputs become parameters). */
export interface DiscoveredForm {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly action: string;
  readonly inputs: readonly string[];
  readonly authentication: boolean;
}

export interface DiscoveryOptions {
  readonly timeoutMs: number;
  /** Probe well-known paths (/admin, /api, /graphql, /upload, …). */
  readonly probeCommonPaths: boolean;
}

export interface DiscoveryResult {
  readonly endpoints: readonly Endpoint[];
  readonly forms: readonly DiscoveredForm[];
  readonly graphql: boolean;
  readonly websockets: readonly Endpoint[];
}

/** Discovers endpoints (links, forms, robots hints, common paths), API
 * endpoints (REST/GraphQL), WebSockets and API documentation. */
export interface EndpointDiscoverer {
  discover(input: {
    readonly baseUrl: string;
    readonly pages: readonly CrawledPage[];
    readonly robots: RobotsDirectives;
    readonly options: DiscoveryOptions;
  }): Promise<DiscoveryResult>;
}