/**
 * ValidationStrategyRegistry — Factory/Registry for resolving vulnerability-specific
 * validation strategies.
 */

import type { VulnerabilityType } from '../../../sniper/domain/models/vulnerability-type';
import type { VulnerabilityValidationStrategy } from './validation-strategy';

export interface ValidationStrategyRegistry {
  supports(type: VulnerabilityType): boolean;
  resolve(type: VulnerabilityType): VulnerabilityValidationStrategy | null;
}

export class DefaultValidationStrategyRegistry implements ValidationStrategyRegistry {
  private readonly strategies = new Map<VulnerabilityType, VulnerabilityValidationStrategy>();

  constructor(strategies: readonly VulnerabilityValidationStrategy[]) {
    for (const strategy of strategies) {
      // Register strategy for all vulnerability types it claims to support
      const candidateTypes: VulnerabilityType[] = [
        'SQL_INJECTION',
        'NOSQL_INJECTION',
        'FILE_UPLOAD',
        'XSS',
        'SSRF',
        'IDOR',
        'PATH_TRAVERSAL',
        'COMMAND_INJECTION',
        'AUTH_BYPASS',
        'BROKEN_ACCESS_CONTROL',
        'SECURITY_MISCONFIGURATION',
      ];
      for (const type of candidateTypes) {
        if (strategy.supports(type)) {
          this.strategies.set(type, strategy);
        }
      }
    }
  }

  supports(type: VulnerabilityType): boolean {
    return this.strategies.has(type);
  }

  resolve(type: VulnerabilityType): VulnerabilityValidationStrategy | null {
    return this.strategies.get(type) ?? null;
  }
}
