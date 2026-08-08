import type { SniperConfig } from '../../src/config';
import type { Sandbox } from '../../src/sandbox/domain/models/sandbox';
import type { SniperRepository } from '../../src/sniper/domain/ports/sniper-repository';
import type { VerifierRegistry } from '../../src/sniper/domain/ports/vulnerability-verifier';
import { DefaultSniperService } from '../../src/sniper/application/services/sniper.service';
import { DefaultVerifierRegistry } from '../../src/sniper/infrastructure/verifiers/verifier-registry';
import { SqlInjectionVerifier } from '../../src/sniper/infrastructure/verifiers/sql-injection/sql-injection-verifier';
import { MemorySniperRepository } from './sniper-repository-memory';
import { StubSandboxManager } from './stub-sandbox-manager';

export const TEST_SNIPER_CONFIG: SniperConfig = {
  attemptTimeoutMs: 5_000,
  maxAttempts: 2,
  concurrency: 2,
  retryDelayMs: 0,
  storeSummaryBytes: 4_000,
  maxOutputLines: 2_000,
};

export interface SniperHarness {
  service: DefaultSniperService;
  repository: MemorySniperRepository;
  manager: StubSandboxManager;
}

/** Build a fully-testable Sniper service (real verifier, scripted sandbox). */
export function createSniperHarness(
  opts: {
    verifiers?: VerifierRegistry;
    config?: SniperConfig;
    repository?: SniperRepository;
    manager?: StubSandboxManager;
  } = {}
): SniperHarness {
  const repository = opts.repository ?? new MemorySniperRepository();
  const manager = opts.manager ?? new StubSandboxManager();
  const service = new DefaultSniperService({
    repository,
    manager: manager,
    verifiers: opts.verifiers ?? new DefaultVerifierRegistry([new SqlInjectionVerifier()]),
    config: opts.config ?? TEST_SNIPER_CONFIG,
  });
  return { service, repository, manager };
}

/** A live sandbox stub for a scan (status ready). */
export function stubSandbox(sandboxId: string, scanId: string): Sandbox {
  return {
    id: sandboxId,
    scanId,
    type: 'runtime',
    status: 'ready',
    image: 'amass/sniper:local',
    repositoryPath: '/tmp/repo',
    network: { egress: 'internal', allowlist: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}