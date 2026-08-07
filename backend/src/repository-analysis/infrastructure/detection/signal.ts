import type { TechnologyCategory } from '../../domain/models/technology';

/**
 * A declarative, data-driven detection rule. A signal matches when ANY of
 * its configured ingredients is observed; confidence grades the strength of
 * the rule, so weak hints can coexist with strong ones.
 */
export interface ManifestContainsRule {
  /** Exact relative path of a manifest file to inspect. */
  readonly path: string;
  /** Substring that must appear in the file content. */
  readonly needle: string;
}

export interface TechnologySignal {
  readonly name: string;
  readonly category: TechnologyCategory;
  readonly confidence: number;
  readonly description?: string;
  /** File names (basenames) present anywhere in the tree. */
  readonly files?: readonly string[];
  /** Exact relative paths. */
  readonly paths?: readonly string[];
  /** Glob patterns matched against relative paths. */
  readonly globs?: readonly string[];
  /** Lowercase file extensions (without the dot). */
  readonly extensions?: readonly string[];
  /** Top-level directory names. */
  readonly directories?: readonly string[];
  /** Dependency names matched against package.json (prefix/scoped aware). */
  readonly pkgDependencies?: readonly string[];
  /** Dependency names matched against requirements.txt / pyproject.toml. */
  readonly pyDependencies?: readonly string[];
  /** package.json `engines` keys that must be present. */
  readonly engines?: readonly string[];
  /** Substring checks inside safe manifest files. */
  readonly manifestContains?: readonly ManifestContainsRule[];
}