import type {
  VerifierRegistry,
  VulnerabilityVerifier,
} from '../../domain/ports/vulnerability-verifier';
import type { VulnerabilityType } from '../../domain/models/vulnerability-type';
import { SUPPORTED_VULNERABILITY_TYPES } from '../../domain/models/vulnerability-type';

/**
 * Concrete verifier registry. New vulnerability types register here — the
 * orchestration flow never changes. `supports` returns false for types with
 * no registered verifier (XSS/SSRF/etc. in later phases), and the Sniper
 * records those targets as NOT_TESTED rather than guessing.
 */
export class DefaultVerifierRegistry implements VerifierRegistry {
  private readonly byType = new Map<VulnerabilityType, VulnerabilityVerifier>();

  constructor(verifiers: readonly VulnerabilityVerifier[]) {
    for (const verifier of verifiers) {
      for (const type of supportedTypes(verifier)) {
        this.byType.set(type, verifier);
      }
    }
  }

  supports(type: VulnerabilityType): boolean {
    return this.byType.has(type);
  }

  getVerifier(type: VulnerabilityType): VulnerabilityVerifier | null {
    return this.byType.get(type) ?? null;
  }
}

function supportedTypes(verifier: VulnerabilityVerifier): VulnerabilityType[] {
  // The registry accepts the canonical type list; each verifier narrows it.
  return SUPPORTED_VULNERABILITY_TYPES.filter((t) => verifier.supports(t));
}