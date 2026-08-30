/**
 * Normalized inputs the Planner reasons over. Everything is read-only: the
 * Planner never probes, scans or executes anything.
 */

export interface StaticVulnInput {
  readonly id?: string;
  readonly vulnerabilityId?: string;
  readonly type: string;
  /** CRITICAL | HIGH | MEDIUM | LOW | INFO */
  readonly severity: string;
  readonly cwe: string | null;
  readonly cve: string | null;
  readonly confidence: number;
  readonly message: string;
  readonly filePath?: string | null;
}

export interface SurfaceInput {
  readonly url: string;
  readonly method: string;
  readonly parameters: readonly string[];
  readonly authentication: boolean;
  /** Scout heuristic risk (LOW..CRITICAL) — a signal, not a verdict. */
  readonly risk: string;
  readonly source: string;
  readonly statusCode: number | null;
}

export interface ProfileInput {
  readonly language: string | null;
  readonly framework: string | null;
  readonly technologies: readonly string[];
}

export interface PlanRequest {
  readonly scanId: string;
  readonly staticFindings: readonly StaticVulnInput[];
  readonly attackSurface: readonly SurfaceInput[];
  readonly profile: ProfileInput;
}