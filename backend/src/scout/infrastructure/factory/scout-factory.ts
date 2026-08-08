import { scoutConfig } from '../../../config';
import type { ScoutToolRuntime } from '../../domain/ports/scout-tool-runtime';
import type { ScoutService } from '../../domain/ports/scout-service';
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
import { createSandboxInfrastructure } from '../../../sandbox/infrastructure/factory/sandbox-factory';

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
export function createScoutService(): ScoutService {
  const deps: ScoutServiceDeps = {
    repository: new PrismaScoutRepository(),
    config: scoutConfig,
    recon: createScoutRecon(),
  };
  return new DefaultScoutService(deps);
}

/** Bind CLI tools to the target application's sandbox (deploy-time: requires
 * a created runtime sandbox id). HTTP probes still run in-process. */
export function createSandboxBoundScoutService(sandboxId: string): ScoutService {
  const manager = createSandboxInfrastructure().manager;
  const deps: ScoutServiceDeps = {
    repository: new PrismaScoutRepository(),
    config: scoutConfig,
    recon: createScoutRecon(new SandboxToolRuntime(manager, sandboxId)),
  };
  return new DefaultScoutService(deps);
}