import { AppError } from '../../../utils/errors';

/** Raised when a scanner's process cannot be started or times out. */
export class ScannerExecutionError extends AppError {
  constructor(scannerId: string, cause?: unknown) {
    const message = cause instanceof Error ? cause.message : 'scanner execution failed';
    super(`Scanner ${scannerId} failed: ${message}`, 502, 'SCANNER_EXECUTION_FAILED', true, {
      scannerId,
    });
  }
}

/** Raised when a requested scan does not exist. */
export class ScanNotFoundError extends AppError {
  constructor(scanId: string) {
    super(`Scan '${scanId}' not found`, 404, 'SCAN_NOT_FOUND', true, { scanId });
  }
}
