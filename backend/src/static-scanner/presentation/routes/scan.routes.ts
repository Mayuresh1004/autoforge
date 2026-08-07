import { Router } from 'express';
import { staticScannerConfig } from '../../../config';
import { repositoryProfileService } from '../../../repository-analysis/presentation/routes/repository-profile.routes';
import { ScanService } from '../../application/services/scan.service';
import { SandboxedScanGateway } from '../../application/services/sandboxed-scan-gateway';
import { createRepositoryTargetAnalyzer } from '../../application/services/repository-target-analyzer';
import type { StaticScanGateway } from '../../application/ports/static-scan-gateway';
import { createDefaultScannerRegistry } from '../../infrastructure/scanning/factory/scanner-factory';
import { ProcessScannerExecutor } from '../../infrastructure/scanning/executor/process-scanner-executor';
import { ScannerRunnerService } from '../../infrastructure/scanning/runner/scanner-runner';
import { KeyedFindingDeduplicator } from '../../infrastructure/scanning/deduplicator/deduplicator';
import { PrismaScanRepository } from '../../infrastructure/persistence/prisma/scan-repository.prisma';
import { ScanController } from '../controllers/scan.controller';
import { createSandboxInfrastructure } from '../../../sandbox/infrastructure/factory/sandbox-factory';
import { SandboxedScanOrchestrator } from '../../../sandbox/application/services/sandboxed-scan-orchestrator';

/**
 * Composition root for the static scanner. The gateway the controller sees is
 * one of:
 *   - classic   (`STATIC_SCAN_RUNTIME=classic`)  → `ScanService` (preparer-cloned)
 *   - sandboxed (default)                        → `SandboxedScanGateway`, whose
 *     create runs the whole clone→analyze→scan inside a manager-owned sandbox;
 *     reads still go to `ScanService` for persisted results.
 * The sandbox backend is chosen by `SANDBOX_RUNTIME` (process default, docker
 * on a container host).
 */
const runner = new ScannerRunnerService();
const deduplicator = new KeyedFindingDeduplicator();
const repository = new PrismaScanRepository();
const severityThreshold = staticScannerConfig.severityThreshold;

const scanService = new ScanService({
  preparer: repositoryProfileService,
  registry: createDefaultScannerRegistry(new ProcessScannerExecutor()),
  runner,
  deduplicator,
  repository,
  severityThreshold,
});

const gateway: StaticScanGateway =
  staticScannerConfig.runtime === 'classic'
    ? scanService
    : new SandboxedScanGateway(
        new SandboxedScanOrchestrator({
          manager: createSandboxInfrastructure().manager,
          analyzeTarget: createRepositoryTargetAnalyzer(),
          runner,
          deduplicator,
          repository,
          severityThreshold,
        }),
        scanService
      );

const controller = new ScanController(gateway);

const router = Router();

router.post('/scan/static', controller.createStaticScan);
router.get('/scan/:id', controller.getScan);
router.get('/scan/:id/results', controller.getScanResults);
router.get('/scan/:id/statistics', controller.getScanStatistics);

export { router as scanRoutes };