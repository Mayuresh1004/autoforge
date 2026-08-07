import type { ScannerExecutor } from '../../../domain/ports/scanner-executor';
import type { ScannerRegistry } from '../../../domain/ports/scanner-registry';
import { DefaultScannerRegistry } from '../registry/scanner-registry';
import { BanditScanner } from '../scanners/bandit/bandit-scanner';
import { PipAuditScanner } from '../scanners/pip-audit/pip-audit-scanner';
import { SemgrepScanner } from '../scanners/semgrep/semgrep-scanner';
import { NpmAuditScanner } from '../scanners/npm-audit/npm-audit-scanner';

/**
 * Single source of truth for the built-in scanner set. The scanner suite is
 * bound to whatever `ScannerExecutor` is in effect — the direct process
 * executor, or a sandboxed one routed through the Sandbox Manager.
 */
export function createDefaultScannerRegistry(executor: ScannerExecutor): ScannerRegistry {
  return new DefaultScannerRegistry([
    new BanditScanner(executor),
    new PipAuditScanner(executor),
    new SemgrepScanner(executor),
    new NpmAuditScanner(executor),
  ]);
}