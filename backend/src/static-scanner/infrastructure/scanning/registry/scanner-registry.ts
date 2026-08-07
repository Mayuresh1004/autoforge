import type { ScannerRegistry } from '../../../domain/ports/scanner-registry';
import type { Scanner } from '../../../domain/ports/scanner';
import type { ScanTargetProfile } from '../../../domain/models/scan-target';

/**
 * Default registry. Adding a scanner is a one-line registration here; no
 * existing scanner code is modified (Open/Closed).
 */
export class DefaultScannerRegistry implements ScannerRegistry {
  private readonly scanners: Scanner[] = [];

  constructor(scanners: readonly Scanner[] = []) {
    for (const scanner of scanners) this.register(scanner);
  }

  register(scanner: Scanner): void {
    if (!this.scanners.some((existing) => existing.id === scanner.id)) {
      this.scanners.push(scanner);
    }
  }

  getAll(): readonly Scanner[] {
    return [...this.scanners];
  }

  select(profile: ScanTargetProfile): readonly Scanner[] {
    return this.scanners.filter((scanner) => scanner.isApplicable(profile));
  }
}