/**
 * Domain models describing a target repository and the result of cloning it.
 *
 * These are immutable DTOs that flow across the application boundary. They
 * deliberately contain no logic or I/O so they can be shared by the
 * application orchestrator and the persistence/presentation layers.
 */

export type RepositoryProvider = 'github';

/**
 * Canonical identity of a repository after URL resolution/validation.
 */
export interface RepositoryIdentity {
  readonly provider: RepositoryProvider;
  readonly owner: string;
  readonly name: string;
  /** URL used to clone the repository (safe, reconstructed value). */
  readonly cloneUrl: string;
  /** Canonical human-facing URL. */
  readonly homepageUrl: string;
  /** Branch assumed to be the default; resolved precisely at scan time. */
  readonly defaultBranch: string;
}

/**
 * Result of a low-level clone operation (infrastructure concern).
 */
export interface CloneResult {
  readonly path: string;
  readonly commitSha: string | null;
}

/**
 * A cloned working tree plus the metadata collected around it.
 */
export interface ClonedRepository {
  readonly identity: RepositoryIdentity;
  /** Absolute filesystem path to the cloned working tree. */
  readonly localPath: string;
  readonly commitSha: string | null;
  readonly sizeBytes: number;
  readonly clonedAt: Date;
}