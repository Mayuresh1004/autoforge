import type { ScannerExecutor, ScannerOutput } from '../../../domain/ports/scanner-executor';
import type { ScannerCommand } from '../../../domain/ports/scanner';
import { ProcessSandboxRuntime } from '../../../../sandbox/infrastructure/process-sandbox';

/**
 * Executes scanner CLIs through the shared sandbox: argv-only (no shell),
 * a hard timeout (SIGTERM), a bounded output buffer, a network policy (egress
 * blocked by default via `unshare --net` when the host supports it), and an
 * allowlisted environment so project secrets never reach child processes.
 */
export class ProcessScannerExecutor implements ScannerExecutor {
  private readonly sandbox: ProcessSandboxRuntime;
  private readonly maxBuffer: number;

  constructor(maxBuffer = 32 * 1024 * 1024, sandbox?: ProcessSandboxRuntime) {
    this.maxBuffer = maxBuffer;
    this.sandbox = sandbox ?? new ProcessSandboxRuntime();
  }

  async execute(command: ScannerCommand): Promise<ScannerOutput> {
    return this.sandbox.run({
      argv: command.argv,
      cwd: command.cwd,
      timeoutMs: command.timeoutMs,
      maxBufferBytes: this.maxBuffer,
      envAllowlist: ['PATH', 'HOME', 'TMPDIR'],
      network: command.network === true ? 'net' : 'none',
    });
  }
}