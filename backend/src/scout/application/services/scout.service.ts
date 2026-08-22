import { logger } from '../../../config/logger';
import type { AttackSurfaceReport, ScoutHealth } from '../../domain/models/scout-report';
import { EMPTY_SCOUT_SUMMARY, type ScoutSummary } from '../../domain/models/scout-scan';
import { ScoutRunError, ScoutScanNotFoundError } from '../../domain/errors/scout.errors';
import type { ScoutRepository } from '../../domain/ports/scout-repository';
import type { ScoutService, RunScoutInput } from '../../domain/ports/scout-service';
import type { AttackSurfaceEntry } from '../../domain/models/attack-surface';
import type { ScoutConfig, EventsConfig } from '../../../config';
import { eventsConfig } from '../../../config';
import type { AmassEventPublisher } from '../../../observability/domain/ports/event-bus';
import { ScoutRecon, resolveOptions, type ResolvedScoutOptions } from './scout-recon';

export interface ScoutServiceDeps {
  readonly repository: import('../../domain/ports/scout-repository').ScoutRepository;
  readonly config: ScoutConfig;
  readonly recon: ScoutRecon;
  /** Phase 9 observability publisher (default: silent). */
  readonly events?: AmassEventPublisher;
  readonly eventsConfig?: Pick<EventsConfig, 'endpointCap'>;
}

/**
 * Orchestrates a full recon run:
 *   context → health → crawl → robots → fingerprint → port scan → discover
 *   → prioritize → persist → report.
 * Each phase is guarded in `ScoutRecon`; a failing tool is logged/reported and
 * the run continues. Recon never exploits, never writes to the target, and only
 * issues idle GET/HEAD probes within the sandbox scope.
 */
export class DefaultScoutService implements ScoutService {
  constructor(private readonly deps: ScoutServiceDeps) {}

  async run(input: RunScoutInput): Promise<AttackSurfaceReport> {
    const context = await this.deps.repository.getContext(input.scanId);
    if (!context) throw new ScoutScanNotFoundError(input.scanId);

    const target = new URL(input.targetUrl);
    const opts = resolveOptions(this.deps.config, input);
    const errors: string[] = [];

    logger.info({ scanId: input.scanId, targetUrl: input.targetUrl }, 'scout.run: started');

    this.emit(input.scanId, {
      eventType: 'SCOUT_STARTED',
      agentType: 'SCOUT',
      phase: 'recon',
      status: 'STARTED',
      message: `recon started for ${input.targetUrl}`,
      metadata: { targetUrl: input.targetUrl },
    });

    const scoutScan = await this.deps.repository.createScoutScan({
      scanId: input.scanId,
      targetUrl: input.targetUrl,
    });
    await this.deps.repository.markRunning(scoutScan.id, new Date());

    try {
      const r = this.deps.recon;
      const health = await this.probeHealth(input.targetUrl, opts, errors);
      const pages = await r.crawl(input.targetUrl, opts, errors);
      const robots = await r.robots(input.targetUrl, opts, errors);
      const technologies = await r.fingerprint(input.targetUrl, pages, opts, errors);
      const { ports, services } = await r.scanPorts(target.hostname, opts, errors);
      const discovery = await r.discover(input.targetUrl, pages, robots, opts, errors);
      const attackSurface = r.prioritize(discovery.endpoints, technologies);
      const summary = this.buildSummary(attackSurface, discovery, ports.length, services.length, technologies.length);

      let htmlEndpoints = 0;
      let javascriptEndpoints = 0;
      let openapiEndpoints = 0;
      let heuristicEndpoints = 0;
      let parameterizedEndpoints = 0;

      for (const entry of attackSurface) {
        if (entry.parameters.length > 0) parameterizedEndpoints++;
        if (entry.source === 'docs') openapiEndpoints++;
        else if (entry.source === 'api') javascriptEndpoints++;
        else if (entry.source === 'link' || entry.source === 'form' || entry.source === 'crawler') htmlEndpoints++;
        else if (entry.source === 'common-path' || entry.source === 'robots') heuristicEndpoints++;
      }

      logger.info(
        {
          scanId: input.scanId,
          htmlEndpoints,
          javascriptEndpoints,
          openapiEndpoints,
          heuristicEndpoints,
          uniqueEndpoints: attackSurface.length,
          parameterizedEndpoints,
        },
        'SCOUT_DISCOVERY_SUMMARY'
      );

      await this.deps.repository.persist(scoutScan.id, {
        attackSurface,
        technologies,
        ports,
        services,
      });
      await this.deps.repository.completeScoutScan(scoutScan.id, 'COMPLETED', summary, new Date());

      const cap = this.deps.eventsConfig?.endpointCap ?? eventsConfig.endpointCap;
      for (const entry of attackSurface.slice(0, cap)) {
        this.emit(input.scanId, {
          eventType: 'SCOUT_ENDPOINT_DISCOVERED',
          agentType: 'SCOUT',
          phase: 'recon',
          status: 'SUCCEEDED',
          message: `endpoint ${entry.method} ${entry.url}`,
          metadata: { endpoint: entry.url, method: entry.method, httpStatus: entry.statusCode ?? undefined, source: entry.source },
        });
      }
      this.emit(input.scanId, {
        eventType: 'SCOUT_COMPLETED',
        agentType: 'SCOUT',
        phase: 'recon',
        status: 'COMPLETED',
        message: `scout finished with ${attackSurface.length} endpoints`,
        metadata: { counts: { endpoints: attackSurface.length, ports: ports.length } },
      });

      logger.info(
        {
          scoutScanId: scoutScan.id,
          endpoints: attackSurface.length,
          ports: ports.length,
          errors: errors.length,
        },
        'scout.run: complete',
      );

      return {
        scanId: input.scanId,
        scoutScanId: scoutScan.id,
        targetUrl: input.targetUrl,
        status: 'COMPLETED',
        health,
        summary,
        attackSurface,
        technologies,
        ports,
        services,
        errors,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit(input.scanId, {
        eventType: 'SCOUT_COMPLETED',
        agentType: 'SCOUT',
        phase: 'recon',
        level: 'ERROR',
        status: 'FAILED',
        message: 'scout run failed',
        metadata: { error: message },
      });
      logger.error({ scoutScanId: scoutScan.id, err }, 'scout.run: failed');
      await this.deps.repository
        .completeScoutScan(scoutScan.id, 'FAILED', EMPTY_SCOUT_SUMMARY, new Date())
        .catch(() => undefined);
      if (err instanceof ScoutRunError) throw err;
      throw new ScoutRunError(message);
    }
  }

  private emit(
    scanId: string,
    input: Omit<import('../../../observability/domain/ports/event-bus').AmassEventInput, 'scanId'>,
  ): void {
    if (!this.deps.events) return;
    try {
      this.deps.events.publish({ ...input, scanId });
    } catch (error) {
      logger.warn({ err: error }, 'scout.events: publish ignored');
    }
  }

  async getScoutScan(scoutScanId: string) {
    return this.deps.repository.getScoutScan(scoutScanId);
  }

  async listScoutScans(scanId: string) {
    return this.deps.repository.listScoutScans(scanId);
  }

  private async probeHealth(
    targetUrl: string,
    opts: ResolvedScoutOptions,
    errors: string[],
  ): Promise<ScoutHealth> {
    const probe = await this.deps.recon.probe(targetUrl, {
      method: 'HEAD',
      timeoutMs: opts.probeTimeoutMs,
      maxBodyBytes: 8 * 1024,
    });
    if (!probe.ok) errors.push(`health: ${probe.error ?? 'unreachable'}`);
    return {
      reachable: probe.ok,
      statusCode: probe.statusCode,
      latencyMs: probe.latencyMs,
      error: probe.error,
    };
  }

  private buildSummary(
    attackSurface: readonly AttackSurfaceEntry[],
    discovery: DiscoverySummaryPart,
    ports: number,
    services: number,
    technologies: number,
  ): ScoutSummary {
    return {
      ports,
      services,
      endpoints: attackSurface.length,
      forms: discovery.forms.length,
      adminPanels: attackSurface.filter(
        (e) => (e.risk === 'HIGH' || e.risk === 'CRITICAL') && /(admin|administrator|console)/.test(e.url),
      ).length,
      graphql: discovery.graphql,
      websockets: discovery.websockets.length,
      technologies,
    };
  }
}

interface DiscoverySummaryPart {
  readonly forms: readonly unknown[];
  readonly graphql: boolean;
  readonly websockets: readonly unknown[];
}

/** Re-export for consumers building deps (factory/tests). */
export { resolveOptions };
export type { ResolvedScoutOptions };