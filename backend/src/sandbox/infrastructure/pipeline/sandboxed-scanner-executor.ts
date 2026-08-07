import type { ScannerCommand } from '../../../static-scanner/domain/ports/scanner';
import type {
  ScannerExecutor,
  ScannerOutput,
} from '../../../static-scanner/domain/ports/scanner-executor';
import type { SandboxManager } from '../../domain/ports/sandbox-manager';

/**
 * Adapts a scanner CLI execution to a typed operation on a sandbox the
 * Sandbox Manager owns. Scanners keep building plain `ScannerCommand`s; this
 * executor is what makes those commands physically run inside the sandbox
 * (argv-only, allowlisted env, hard timeout, network policy honored).
 */
export class SandboxedScannerExecutor implements ScannerExecutor {
  constructor(
    private readonly manager: SandboxManager,
    private readonly sandboxId: string
  ) {}

  async execute(command: ScannerCommand): Promise<ScannerOutput> {
    const result = await this.manager.execute(this.sandboxId, {
      argv: command.argv,
      cwd: command.cwd,
      timeoutMs: command.timeoutMs,
      envAllowlist: ['PATH', 'HOME', 'TMPDIR'],
      network: command.network === true ? 'egress' : 'none',
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    };
  }
}