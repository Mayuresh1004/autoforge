/**
 * Sandbox runtime errors — raised when a requested capability cannot be
 * provided by the active backend. Runtime (containerized) sandboxes need a
 * Docker-capable backend; the process backend (headless/no-Docker) raises
 * these instead of pretending.
 */

export class SandboxRuntimeUnsupportedError extends Error {
  readonly code = 'SANDBOX_RUNTIME_UNSUPPORTED';
  readonly capability: string;

  constructor(capability: string) {
    super(`active sandbox backend does not support '${capability}' (requires a Docker host)`);
    this.name = 'SandboxRuntimeUnsupportedError';
    this.capability = capability;
  }
}

export class SandboxImageBuildError extends Error {
  readonly code = 'SANDBOX_IMAGE_BUILD_FAILED';
  /** Truncated docker build output (never secrets). */
  readonly buildOutput: string;

  constructor(detail: string, buildOutput: string) {
    super(`sandbox image build failed: ${detail}`);
    this.name = 'SandboxImageBuildError';
    this.buildOutput = buildOutput;
  }
}