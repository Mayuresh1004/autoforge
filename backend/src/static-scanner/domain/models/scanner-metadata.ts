/**
 * Declarative capabilities of a scanner — used by the registry for
 * technology-based selection.
 */

export type ScannerKind = 'source' | 'dependency' | 'general';

export interface ScannerMetadata {
  /** Stable lowercase id (e.g. `bandit`). */
  readonly id: string;
  /** Human label (e.g. `Bandit`). */
  readonly engine: string;
  readonly kind: ScannerKind;
  /** Languages this scanner understands (empty = language-agnostic). */
  readonly languages: readonly string[];
  readonly description: string;
  /** Whether execution may contact external networks (e.g. npm audit). */
  readonly networkAccess: boolean;
}
