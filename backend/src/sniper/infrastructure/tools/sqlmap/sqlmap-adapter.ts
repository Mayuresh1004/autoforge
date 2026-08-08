import type { ToolExecResult, ToolRuntime } from '../../../domain/ports/tool-runtime';
import { buildSqlMapArgv, type SqlMapArgv, type SqlMapRunOptions } from './sqlmap-argv';

/**
 * SqlMapAdapter — the ONLY component that knows how to run sqlmap. It
 * translates an AMASS verification request into a controlled sqlmap
 * execution (argv + sandbox network policy) and returns the raw result.
 * Parsing and verdict logic live elsewhere — this adapter never interprets
 * output, it only executes.
 */
export class SqlMapAdapter {
  constructor(private readonly runtime: ToolRuntime) {}

  /** Build the exact argv (exposed for tests) without executing. */
  buildArgv(options: SqlMapRunOptions): SqlMapArgv {
    return buildSqlMapArgv(options);
  }

  /**
   * Execute one bounded sqlmap run through the sandbox-bound runtime.
   * `network: 'internal'` keeps sqlmap inside the private app network —
   * never host egress, never an external network.
   */
  async run(options: SqlMapRunOptions): Promise<ToolExecResult> {
    const { argv } = this.buildArgv(options);
    return this.runtime.execute({
      argv,
      timeoutMs: options.timeoutMs,
      network: 'internal',
      envAllowlist: ['PATH', 'HOME', 'PYTHONDONTWRITEBYTECODE'],
      envOverrides: { HOME: '/tmp', PYTHONDONTWRITEBYTECODE: '1' },
    });
  }
}