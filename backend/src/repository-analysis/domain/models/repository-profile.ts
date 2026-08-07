/**
 * A single, JSON-serializable "layer profile" that summarises every analysis
 * stage for one repository. This is the aggregate output of the clone →
 * analyse → assemble pipeline, and the payload served by the API.
 *
 * It is deliberately a projection: heavy internal structures (the full file
 * tree, per-file metadata, raw manifest content) are NOT exposed here.
 */
import type { DependencyCategory } from './dependencies';

export interface ProfileTechnology {
  readonly name: string;
  readonly category: string;
  readonly confidence: number;
}

export interface ProfileFilesystem {
  readonly fileCount: number;
  readonly folderCount: number;
  readonly totalSizeBytes: number;
  readonly linesOfCode: number;
  /** Top file extensions by count (keys like `ts`, `py`, `(none)`). */
  readonly topExtensions: readonly [string, number][];
  /** Paths of notable files (README, manifests, lockfiles, configs). */
  readonly importantFiles: readonly string[];
}

export interface ProfileDependencyEcosystem {
  readonly ecosystem: string;
  readonly source: string;
  readonly count: number;
  readonly runtimes: Record<string, string>;
  readonly librariesByCategory: Partial<Record<DependencyCategory, string[]>>;
}

export interface ProfileArchitectureCandidate {
  readonly type: string;
  readonly confidence: number;
}

export interface ProfileApiEndpoint {
  readonly method: string;
  readonly path: string;
  readonly file: string;
}

export interface ProfileMetadata {
  readonly provider: string;
  readonly owner: string;
  readonly name: string;
  readonly homepageUrl: string;
  readonly cloneUrl: string;
  readonly commitSha: string | null;
  readonly sizeBytes: number;
  readonly clonedAt: string;
  readonly analyzedAt: string;
}

export interface RepositoryProfile {
  readonly meta: ProfileMetadata;
  readonly fileSystem: ProfileFilesystem;
  readonly technologies: {
    readonly primary: ProfileTechnology | null;
    readonly all: readonly ProfileTechnology[];
  };
  readonly dependencies: readonly ProfileDependencyEcosystem[];
  readonly architecture: {
    /** Canonical label, or `Unknown` when the analyzer was uncertain. */
    readonly primary: string;
    readonly candidates: readonly ProfileArchitectureCandidate[];
  };
  readonly api: {
    readonly endpointCount: number;
    readonly protocols: readonly string[];
    readonly graphqlSources: readonly string[];
    readonly endpoints: readonly ProfileApiEndpoint[];
  };
  readonly authentication: {
    readonly schemes: readonly string[];
    readonly libraries: readonly string[];
    readonly middleware: readonly string[];
  };
}

export type { DependencyCategory };