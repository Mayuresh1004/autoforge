/** Domain errors for the Sniper Agent. Each maps to a 4xx/5xx by the
 * presentation layer and stays explainable in logs. */

export class SniperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SniperError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TargetNotFoundError extends SniperError {
  constructor(targetId: string) {
    super(`Planned target not found: ${targetId}`);
    this.name = 'TargetNotFoundError';
  }
}

/** The planned target belongs to a different scan than the sandbox. */
export class SandboxMismatchError extends SniperError {
  constructor(sandboxId: string, targetId: string, expectedScanId: string, actualScanId: string) {
    super(
      `Sandbox ${sandboxId} is scoped to scan '${actualScanId}' but target '${targetId}' belongs to scan '${expectedScanId}'`
    );
    this.name = 'SandboxMismatchError';
  }
}

export class SandboxUnavailableError extends SniperError {
  constructor(sandboxId: string, reason?: string) {
    super(reason ? `Sandbox unavailable: ${sandboxId} (${reason})` : `Sandbox unavailable: ${sandboxId}`);
    this.name = 'SandboxUnavailableError';
  }
}

/** Endpoint escapes the sandbox app's origin — never verified. */
export class CrossOriginTargetError extends SniperError {
  constructor(endpoint: string, baseUrl: string) {
    super(`Endpoint '${endpoint}' is not same-origin with sandbox target '${baseUrl}'`);
    this.name = 'CrossOriginTargetError';
  }
}

/** No candidate vulnerability maps to a supported verifier (e.g. XSS). */
export class UnsupportedVulnerabilityTypeError extends SniperError {
  constructor(targetId: string, label: string, supported: string) {
    super(`Target '${targetId}' candidate '${label}' is unsupported (supported: ${supported})`);
    this.name = 'UnsupportedVulnerabilityTypeError';
  }
}

/** Target requires auth but no credentials were explicitly supplied. */
export class AuthenticationUnavailableError extends SniperError {
  constructor(targetId: string) {
    super(
      `Target '${targetId}' requires authentication but no credentials were provided; verification was not attempted`
    );
    this.name = 'AuthenticationUnavailableError';
  }
}

/** The verifier itself failed (tool binary missing, sandbox exec error). */
export class VerifierExecutionError extends SniperError {
  constructor(verifier: string, message: string) {
    super(`Verifier '${verifier}' failed: ${message}`);
    this.name = 'VerifierExecutionError';
  }
}

export class InvalidBaseUrlError extends SniperError {
  constructor(baseUrl: string) {
    super(`Invalid sandbox base URL: ${baseUrl}`);
    this.name = 'InvalidBaseUrlError';
  }
}