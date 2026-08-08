/**
 * Recon-only models for the Scout Agent. These types carry *no* offensive
 * semantics: they describe what is reachable, not what can be exploited.
 * Risk here is a heuristic priority only (see AttackSurfacePrioritizer).
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** Preliminary heuristic risk. Scout never determines exploitability. */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type DiscoverySource =
  | 'health'
  | 'crawler'
  | 'link'
  | 'form'
  | 'robots'
  | 'sitemap'
  | 'common-path'
  | 'api'
  | 'graphql'
  | 'websocket'
  | 'docs';

/** A discovered HTTP endpoint (pre-risk, pre-attribution). */
export interface Endpoint {
  readonly url: string;
  readonly method: HttpMethod;
  readonly parameters: readonly string[];
  readonly authentication: boolean;
  readonly source: DiscoverySource;
  /** HTTP status observed when probed (null when unreachable). */
  readonly statusCode: number | null;
}

/** The attack-surface record: an endpoint enriched with risk / tech / reachability. */
export interface AttackSurfaceEntry {
  readonly id: string;
  readonly url: string;
  readonly method: HttpMethod;
  readonly parameters: readonly string[];
  readonly authentication: boolean;
  readonly technology: readonly string[];
  readonly risk: RiskLevel;
  readonly source: DiscoverySource;
  readonly reachable: boolean;
  readonly statusCode: number | null;
}

/** A technology identified during fingerprinting. */
export interface DetectedTechnology {
  readonly name: string;
  readonly category: string;
  readonly version: string | null;
  /** 0..1 confidence — a heuristic, never a security decision. */
  readonly confidence: number;
  readonly evidence: string;
}

/** An open port discovered during recon. */
export interface OpenPort {
  readonly port: number;
  readonly protocol: string;
  readonly state: 'open' | 'closed' | 'filtered';
  readonly service: string | null;
}

/** A network service attributed from open ports. */
export interface DiscoveredService {
  readonly name: string;
  readonly protocol: string;
  readonly port: number | null;
  readonly version: string | null;
  readonly evidence: string | null;
}