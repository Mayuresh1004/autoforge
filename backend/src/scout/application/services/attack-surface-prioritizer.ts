import type { RiskLevel } from '../../domain/models/attack-surface';
import type { EndpointSignals } from '../../domain/classification';

/**
 * Preliminary, heuristic risk for recon ordering. Scout NEVER determines
 * exploitability — these priorities (per the phase spec) are rough ordering
 * signals only:
 *   authenticated upload  → CRITICAL
 *   admin/high-value      → HIGH
 *   auth'd api w/ params  → HIGH
 *   public api w/ params  → MEDIUM
 *   login page            → MEDIUM
 *   docs / health / static→ LOW
 */
export interface AttackSurfacePrioritizer {
  assignRisk(signals: EndpointSignals): RiskLevel;
}

export class HeuristicAttackSurfacePrioritizer implements AttackSurfacePrioritizer {
  assignRisk(signals: EndpointSignals): RiskLevel {
    if (signals.isUpload) {
      return signals.authentication ? 'CRITICAL' : 'HIGH';
    }
    if (signals.isAdmin) {
      return 'HIGH';
    }
    if (signals.isApi) {
      if (signals.authentication && signals.hasParameters) return 'HIGH';
      if (signals.hasParameters) return 'MEDIUM';
      return 'LOW';
    }
    if (signals.isLogin) return 'MEDIUM';
    if (signals.isDocs) return 'LOW';
    if (signals.isHealth) return 'LOW';
    if (signals.isStaticAsset) return 'LOW';
    if (signals.statusCode !== null && signals.statusCode >= 400) return 'LOW';
    return 'MEDIUM';
  }
}