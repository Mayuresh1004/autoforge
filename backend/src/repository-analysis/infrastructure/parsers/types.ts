import type { DependencyScope } from '../../domain/models/dependencies';

/**
 * Internal (non-classified) representation produced by a manifest parser.
 */
export interface RawDependency {
  readonly name: string;
  readonly version: string | null;
  readonly scope: DependencyScope;
}

export interface RawManifest {
  readonly runtimes: Record<string, string | null>;
  readonly dependencies: readonly RawDependency[];
}

export type ManifestParser = (raw: string) => RawManifest;