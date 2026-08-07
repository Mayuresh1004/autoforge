import { execFile } from 'node:child_process';
import type { ScannerExecutor, ScannerOutput } from '../../../domain/ports/scanner-executor';
import type { ScannerCommand } from '../../../domain/ports/scanner';

interface ExecFileError extends Error {
  code?: number | null;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
}

/**
 * Executes scanner CLIs safely: argv-only (no shell), a hard timeout (killed
 * with SIGTERM), and a bounded output buffer. Never sets secret env vars.
 */
export class ProcessScannerExecutor implements ScannerExecutor {
  private readonly maxBuffer: number;

  constructor(maxBuffer = 32 * 1024 * 1024) {
    this.maxBuffer = maxBuffer;
  }

  async execute(command: ScannerCommand): Promise<ScannerOutput> {
    const [file, ...args] = command.argv;

    try {
      const { stdout, stderr } = await promisifiedExecFile(file, args, {
        cwd: command.cwd,
        timeout: command.timeoutMs,
        maxBuffer: this.maxBuffer,
        env: process.env as NodeJS.ProcessEnv,
      });
      return { stdout, stderr, exitCode: 0, timedOut: false };
    } catch (error) {
      const err = error as ExecFileError;
      return {
        stdout: (err.stdout ?? '') as string,
        stderr: (err.stderr ?? '') as string,
        exitCode: err.code ?? null,
        timedOut: err.killed === true && err.signal === 'SIGTERM',
      };
    }
  }
}

function promisifiedExecFile(
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error as ExecFileError);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}