import { sniperConfig } from '../../../config';
import type { SandboxManager } from '../../../sandbox/domain/ports/sandbox-manager';
import { DefaultSniperService, type SniperServiceDeps } from '../../application/services/sniper.service';
import type { SniperRepository } from '../../domain/ports/sniper-repository';
import type { AmassEventPublisher } from '../../../observability/domain/ports/event-bus';
import type { SniperService } from '../../domain/ports/sniper-service';
import { PrismaSniperRepository } from '../repository/prisma-sniper-repository';
import { DefaultVerifierRegistry } from '../verifiers/verifier-registry';
import { SqlInjectionVerifier } from '../verifiers/sql-injection/sql-injection-verifier';
import { NoSqlInjectionVerifier } from '../verifiers/nosql-injection/nosql-injection-verifier';
import { FileUploadVerifier } from '../verifiers/file-upload/file-upload-verifier';
import { SsrfVerifier } from '../verifiers/ssrf/ssrf-verifier';
import { XssVerifier } from '../verifiers/xss/xss-verifier';
import { BrokenAccessControlVerifier } from '../verifiers/broken-access-control/broken-access-control-verifier';

export interface SniperInfrastructureOptions {
  /** The application composition root's SINGLE shared manager — required so
   *  the Sniper can validate sandboxes created through the runtime surface. */
  readonly manager: SandboxManager;
  readonly repository?: SniperRepository;
  /** Injectable verifier set (defaults: SQL + NoSQL injection + File Upload + SSRF + XSS + Broken Access Control). */
  readonly verifiers?: DefaultVerifierRegistry;
  /** Optional observability publisher (default: no events emitted). */
  readonly events?: AmassEventPublisher;
  readonly rag?: import('../../../knowledge/application/services/rag.service').RagService;
}

/**
 * Composition root for the Sniper Agent. The only component that knows which
 * verifiers exist (SQL + NoSQL + File Upload + SSRF + XSS + Access Control) and which sandbox manager to
 * use. Everything downstream talks to ports. Never builds its own manager.
 */
export function createSniperInfrastructure(
  options: SniperInfrastructureOptions
): { readonly service: SniperService } {
  const verifiers =
    options.verifiers ??
    new DefaultVerifierRegistry([
      new SqlInjectionVerifier(),
      new NoSqlInjectionVerifier(),
      new FileUploadVerifier(),
      new SsrfVerifier(),
      new XssVerifier(),
      new BrokenAccessControlVerifier(),
    ]);
  const deps: SniperServiceDeps = {
    repository: options.repository ?? new PrismaSniperRepository(),
    manager: options.manager,
    verifiers,
    config: sniperConfig,
    events: options.events,
    rag: options.rag,
  };
  return { service: new DefaultSniperService(deps) };
}