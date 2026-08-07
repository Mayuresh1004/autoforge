/**
 * Domain models produced by authentication detection.
 */
export interface AuthenticationDetection {
  /** High-level schemes (e.g. `JWT`, `OAuth2`, `Session`). May be empty. */
  readonly schemes: readonly string[];
  /** Detected auth-related libraries. */
  readonly libraries: readonly string[];
  /** Files that appear to implement auth middleware/guards (limited). */
  readonly middleware: readonly string[];
}