import type { ScannerCommand } from './scanner';

/**
 * Safely executes a scanner CLI (argv array, no shell). Implemented by an
 * infrastructure process adapter; scanners depend on this port, not on
 * `child_process` directly.
 */
export interface ScannerExecutor {
  execute(command: ScannerCommand): Promise<ScannerOutput>;
}

export interface ScannerOutput {
  readonly stdout: string;
  readonly stderr: string;
  /** Process exit code, or null when the process was killed/timed out. */
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}