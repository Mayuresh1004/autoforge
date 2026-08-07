/**
 * Domain models produced by technology detection.
 */

export type TechnologyCategory =
  | 'language'
  | 'framework'
  | 'package-manager'
  | 'build-tool'
  | 'database'
  | 'runtime'
  | 'container'
  | 'ci-cd'
  | 'cloud';

export interface Technology {
  readonly name: string;
  readonly category: TechnologyCategory;
  /** 0..1 confidence in the detection. */
  readonly confidence: number;
  /** Human- and machine-readable hints backing the detection. */
  readonly evidence: readonly string[];
}

export interface TechnologyDetection {
  readonly technologies: readonly Technology[];
}