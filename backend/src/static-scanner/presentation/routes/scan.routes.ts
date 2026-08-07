import { Router } from 'express';
import { staticScannerConfig } from '../../../config';
import { repositoryProfileService } from '../../../repository-analysis/presentation/routes/repository-profile.routes';
import { ScanService } from '../../application/services/scan.service';
import { DefaultScannerRegistry } from '../../infrastructure/scanning/registry/scanner-registry';
import { ProcessScannerExecutor } from '../../infrastructure/scanning/executor/process-scanner-executor';
import { ScannerRunnerService } from '../../infrastructure/scanning/runner/scanner-runner';
import { KeyedFindingDeduplicator } from '../../infrastructure/scanning/deduplicator/deduplicator';
import { PrismaScanRepository } from '../../infrastructure/persistence/prisma/scan-repository.prisma';
import { BanditScanner } from '../../infrastructure/scanning/scanners/bandit/bandit-scanner';
import { PipAuditScanner } from '../../infrastructure/scanning/scanners/pip-audit/pip-audit-scanner';
import { SemgrepScanner } from '../../infrastructure/scanning/scanners/semgrep/semgrep-scanner';
import { NpmAuditScanner } from '../../infrastructure/scanning/scanners/npm-audit/npm-audit-scanner';
import { ScanController } from '../controllers/scan.controller';

/**
 * Composition root for the static scanner. Registers the supported scanners
 * (Open/Closed: adding a scanner = one new file + one registration here).
 */
const executor = new ProcessScannerExecutor();
const registry = new DefaultScannerRegistry([
  new BanditScanner(executor),
  new PipAuditScanner(executor),
  new SemgrepScanner(executor),
  new NpmAuditScanner(executor),
]);

const scanService = new ScanService({
  preparer: repositoryProfileService,
  registry,
  runner: new ScannerRunnerService(),
  deduplicator: new KeyedFindingDeduplicator(),
  repository: new PrismaScanRepository(),
  severityThreshold: staticScannerConfig.severityThreshold,
});

const controller = new ScanController(scanService);

const router = Router();

router.post('/scan/static', controller.createStaticScan);
router.get('/scan/:id', controller.getScan);
router.get('/scan/:id/results', controller.getScanResults);
router.get('/scan/:id/statistics', controller.getScanStatistics);

export { router as scanRoutes };