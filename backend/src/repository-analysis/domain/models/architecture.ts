/**
 * Domain models produced by architecture inference.
 */

export type ArchitectureType =
  | 'monolith'
  | 'microservices'
  | 'monorepo'
  | 'mvc'
  | 'clean'
  | 'hexagonal'
  | 'layered'
  | 'client-server'
  | 'serverless';

export interface ArchitectureCandidate {
  readonly type: ArchitectureType;
  readonly confidence: number;
  readonly evidence: readonly string[];
}

export interface ArchitectureDetection {
  readonly candidates: readonly ArchitectureCandidate[];
  /** Most confident candidate, or null when uncertain (→ "Unknown"). */
  readonly primary: ArchitectureCandidate | null;
}