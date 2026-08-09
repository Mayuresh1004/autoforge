import { scoutConfig, eventsConfig } from '../../../config';
import type { AmassEventPublisher } from '../../../observability/domain/ports/event-bus';
import type { ScoutToolRuntime } from '../../domain/ports/scout-tool-runtime';
import type { ScoutService } from '../../domain/ports/scout-service';
import type { SandboxManager } from '../../../sandbox/domain/ports/sandbox-manager';
import { DefaultScoutService, type ScoutServiceDeps } from '../../application/services/scout.service';
import { HeuristicAttackSurfacePrioritizer } from '../../application/services/attack-surface-prioritizer';
import { ScoutRecon, type ScoutReconDeps } from '../../application/services/scout-recon';
import { PrismaScoutRepository } from '../persistence/prisma-scout-repository';
import { DirectToolRuntime, SandboxToolRuntime } from '../tools/direct-tool-runtime';
import { HttpCrawler } from '../tools/http-crawler';
import { RobotsTxtParser } from '../tools/robots-txt-parser';
import { SignatureTechnologyFingerprinter } from '../tools/signature-technology-fingerprinter';
import { NmapPortScanner } from '../tools/nmap-port-scanner';
import { ScoutEndpointDiscoverer } from '../tools/endpoint-discoverer';

export interface ScoutInfrastructure {
  readonly service: ScoutService;
}

/** Recon tool graph. `runtime` defaults to headless probes; pass a
 * sandbox-bound runtime to keep CLI tools inside the target app's sandbox. */
export function createScoutRecon(runtime?: ScoutToolRuntime): ScoutRecon {
  const toolRuntime = runtime ?? new DirectToolRuntime();
  const deps: ScoutReconDeps = {
    runtime: toolRuntime,
    crawler: new HttpCrawler(toolRuntime),
    robotsParser: new RobotsTxtParser(),
    fingerprinter: new SignatureTechnologyFingerprinter(),
    portScanner: new NmapPortScanner(toolRuntime),
    endpointDiscoverer: new ScoutEndpointDiscoverer(toolRuntime),
    prioritizer: new HeuristicAttackSurfacePrioritizer(),
  };
  return new ScoutRecon(deps);
}

/** Default (headless) Scout service over the Prisma repository. */
export function createScoutService(options: { readonly events?: AmassEventPublisher } = {}): ScoutService {
  const deps: ScoutServiceDeps = {
    repository: new PrismaScoutRepository(),
    config: scoutConfig,
    recon: createScoutRecon(),
    events: options.events,
    eventsConfig,
  };
  return new DefaultScoutService(deps);
}

/** Bind CLI tools to the target application's sandbox (deploy-time: requires
 * a created runtime sandbox id). HTTP probes still run in-process. The
 * manager is the application composition root's shared instance — never
 * built here. */
export function createSandboxBoundScoutService(
  sandboxId: string,
  manager: SandboxManager,
  options: { readonly events?: AmassEventPublisher } = {},
): ScoutService {
  const deps: ScoutServiceDeps = {
    repository: new PrismaScoutRepository(),
    config: scoutConfig,
    recon: createScoutRecon(new SandboxToolRuntime(manager, sandboxId)),
    events: options.events,
    eventsConfig,
  };
  return new DefaultScoutService(deps);
}