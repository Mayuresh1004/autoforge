/**
 * The subset of the Repository Profile that scanners need for selection.
 * Kept intentionally small so the scanner module does not couple to the
 * repository-analysis module's models; the application layer adapts.
 */
export interface ScanTargetProfile {
  readonly languages: readonly string[];
  /** e.g. `npm`, `pip`, `maven`. */
  readonly ecosystems: readonly string[];
  /** Manifest paths the scanners can consume (e.g. `requirements.txt`). */
  readonly dependencySources: readonly string[];
  /** Lockfiles present in the repo (e.g. `package-lock.json`). */
  readonly lockfiles: readonly string[];
  /** Notable files (README, configs, CI, container files). */
  readonly importantFiles: readonly string[];
}
