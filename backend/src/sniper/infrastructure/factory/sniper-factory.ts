import { sniperConfig } from '../../../config';
import type { SandboxManager } from '../../../sandbox/domain/ports/sandbox-manager';
import { createSandboxInfrastructure } from '../../../sandbox/infrastructure/factory/sandbox-factory';
import { DefaultSniperService, type SniperServiceDeps } from '../../application/services/sniper.service';
import type { SniperRepository } from '../../domain/ports/sniper-repository';
import type { SniperService } from '../../domain/ports/sniper-service';
import { PrismaSniperRepository } from '../repository/prisma-sniper-repository';
import { DefaultVerifierRegistry } from '../verifiers/verifier-registry';
import { SqlInjectionVerifier } from '../verifiers/sql-injection/sql-injection-verifier';

export interface SniperInfrastructureOptions {
  readonly manager?: SandboxManager;
  readonly repository?: SniperRepository;
  /** Injectable verifier set (defaults: SQL injection only this phase). */
  readonly verifiers?: DefaultVerifierRegistry;
}

/**
 * Composition root for the Sniper Agent. The only component that knows which
 * verifiers exist (SQL injection for this phase) and which sandbox manager to
 * use. Everything downstream talks to ports.
 */
export function createSniperInfrastructure(
  options: SniperInfrastructureOptions = {}
): { readonly service: SniperService } {
  const manager = options.manager ?? createSandboxInfrastructure().manager;
  const verifiers = options.verifiers ?? new DefaultVerifierRegistry([new SqlInjectionVerifier()]);
  const deps: SniperServiceDeps = {
    repository: options.repository ?? new PrismaSniperRepository(),
    manager,
    verifiers,
    config: sniperConfig,
  };
  return { service: new DefaultSniperService(deps) };
}