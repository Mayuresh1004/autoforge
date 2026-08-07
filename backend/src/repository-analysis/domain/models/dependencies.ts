/**
 * Domain models produced by dependency analysis.
 */

export type DependencyScope = 'runtime' | 'development' | 'peer' | 'optional';

export type DependencyCategory =
  | 'framework'
  | 'auth'
  | 'security'
  | 'orm'
  | 'database'
  | 'ai'
  | 'test'
  | 'lint'
  | 'validation'
  | 'logging'
  | 'http'
  | 'utility'
  | 'other';

export interface ParsedDependency {
  readonly name: string;
  /** Version/specifier as declared in the manifest (may be null). */
  readonly version: string | null;
  readonly scope: DependencyScope;
  /** Zero or more semantic categories (empty for uncategorized). */
  readonly categories: readonly DependencyCategory[];
}

export interface EcosystemSummary {
  /** Human label for the ecosystem (e.g. `npm`, `maven`). */
  readonly ecosystem: string;
  /** Manifest file this summary was derived from (relative path). */
  readonly source: string;
  readonly count: number;
  /** Runtime/pin versions detected in the manifest. */
  readonly runtimes: Partial<Record<string, string>>;
  /** Dependency names grouped by category (names only, no versions). */
  readonly librariesByCategory: Partial<Record<DependencyCategory, string[]>>;
  readonly dependencies: readonly ParsedDependency[];
}

export interface DependencyAnalysis {
  readonly summaries: readonly EcosystemSummary[];
}