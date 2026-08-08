import type { RuntimeRepositoryRef } from '../entities/runtime-sandbox';

/**
 * Read-only gateway to the scan/repository context. Validates that a sandbox
 * is being created for an existing scan and (when the scan has repositories
 * linked) that the requested repository belongs to that scan — authorization
 * authority, not a lifecycle participant.
 */
export interface RuntimeScanGateway {
  scanExists(scanId: string): Promise<boolean>;
  /**
   * true → the scan explicitly owns this repository;
   * false → the repository is NOT owned by the scan (reject);
   * null → the scan has no linked repositories (allowed, recorded).
   */
  scanRepositoryRelation(
    scanId: string,
    repository: RuntimeRepositoryRef
  ): Promise<boolean | null>;
}