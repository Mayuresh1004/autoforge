import type { SandboxManager } from '../../../sandbox/domain/ports/sandbox-manager';
import type { ToolExecRequest, ToolExecResult, ToolRuntime } from '../../domain/ports/tool-runtime';

/**
 * Production execution seam: routes every tool command through the
 * SandboxManager into the target application's sandbox. This is what keeps
 * ALL exploit activity inside the sandbox boundary — no direct Docker, no
 * host execution. `sandboxId` is the id of the running-application sandbox
 * the Sniper is verifying.
 */
export class SandboxToolRuntime implements ToolRuntime {
  constructor(
    private readonly manager: SandboxManager,
    private readonly sandboxId: string
  ) {}

  async execute(request: ToolExecRequest): Promise<ToolExecResult> {
    const sandbox = await this.manager.getSandbox(this.sandboxId).catch(() => null);

    if (sandbox?.networkId) {
      let argv = [...request.argv];
      if (sandbox.ipAddress) {
        argv = argv.map((arg) =>
          arg.replace(/http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/gi, (_match, _host, port) => {
            return `http://${sandbox.ipAddress}${port ?? ''}`;
          })
        );
      }
      const toolResult = await this.manager.executeToolInNetwork({
        networkId: sandbox.networkId,
        argv,
        timeoutMs: request.timeoutMs,
        envAllowlist: request.envAllowlist,
        envOverrides: request.envOverrides,
      });
      return {
        stdout: toolResult.stdout ?? '',
        stderr: toolResult.stderr ?? '',
        exitCode: toolResult.exitCode,
        timedOut: toolResult.timedOut,
      };
    }

    const result = await this.manager.execute(this.sandboxId, {
      argv: [...request.argv],
      timeoutMs: request.timeoutMs,
      envAllowlist: request.envAllowlist ?? ['PATH', 'HOME'],
      envOverrides: request.envOverrides,
      network: request.network ?? 'internal',
    });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    };
  }
}