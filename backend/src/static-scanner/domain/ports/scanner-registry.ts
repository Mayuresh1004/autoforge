import type { Scanner } from './scanner';
import type { ScanTargetProfile } from '../models/scan-target';

/**
 * Registry of all available scanners. Open for extension (a new scanner is
 * registered without touching existing scanner code) and closed for
 * modification. Selection is pure: given a profile it returns the scanners
 * that apply.
 */
export interface ScannerRegistry {
  register(scanner: Scanner): void;
  getAll(): readonly Scanner[];
  /** Scanners applicable for the given repository profile. */
  select(profile: ScanTargetProfile): readonly Scanner[];
}