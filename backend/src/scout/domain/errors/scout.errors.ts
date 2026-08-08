/** Domain errors for the Scout agent. Recon is best-effort: only truly
 * invalid inputs or missing source scans throw. Tool failures never do. */

export class ScoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoutError';
  }
}

export class ScoutScanNotFoundError extends ScoutError {
  constructor(scanId: string) {
    super(`Source scan not found: ${scanId}`);
    this.name = 'ScoutScanNotFoundError';
  }
}

export class ScoutRunError extends ScoutError {
  constructor(message: string) {
    super(message);
    this.name = 'ScoutRunError';
  }
}