/**
 * Domain & REST API Data Models for AMASS Frontend.
 * Matches backend endpoints and domain models.
 */

export interface ApiResponse<T = unknown> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: { code: string; message: string; details?: unknown } | null;
  readonly timestamp: string;
}

export interface HealthData {
  readonly status: 'healthy' | 'degraded' | 'unhealthy' | string;
  readonly service: string;
  readonly version: string;
  readonly uptime: number;
}

export interface VersionData {
  readonly name: string;
  readonly version: string;
  readonly environment: string;
}

export type ScanStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type VulnerabilitySeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface ScanModel {
  readonly id?: string;
  readonly scanId: string;
  readonly repositoryUrl?: string;
  readonly commitHash?: string;
  readonly status: ScanStatus;
  readonly startedAt: string;
  readonly completedAt?: string | null;
  readonly targetUrl?: string;
  readonly error?: string | null;
}

export interface FindingModel {
  readonly id: string;
  readonly scanId?: string;
  readonly ruleId?: string;
  readonly vulnerabilityId?: string;
  readonly type?: string;
  readonly scanner?: string;
  readonly title?: string;
  readonly description?: string;
  readonly message?: string;
  readonly severity: VulnerabilitySeverity;
  readonly confidence?: string | number;
  readonly file?: string | null;
  readonly filePath?: string;
  readonly line?: number | null;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly snippet?: string;
  readonly evidence?: string | null;
  readonly cwe?: string | null;
  readonly cve?: string | null;
  readonly endpoint?: string;
  readonly parameter?: string;
  readonly isConfirmed?: boolean;
}

export interface ScanStatistics {
  readonly totalFindings: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly mediumCount: number;
  readonly lowCount: number;
  readonly infoCount: number;
}

export interface ScoutEndpoint {
  readonly id?: string;
  readonly path?: string;
  readonly url?: string;
  readonly method: string;
  readonly description?: string;
  readonly risk?: string;
  readonly isAuthRequired?: boolean;
  readonly statusCode?: number | null;
  readonly parameters?: Array<{ name: string; type: string; required?: boolean }> | readonly string[];
}

export interface ScoutRunResult {
  readonly scoutScanId: string;
  readonly status: string;
  readonly endpointsDiscovered: number;
  readonly portsDiscovered?: number;
  readonly endpoints?: ScoutEndpoint[];
  readonly attackSurface?: ScoutEndpoint[];
}

export interface TargetModel {
  readonly targetId: string;
  readonly scanId: string;
  readonly endpoint: string;
  readonly method: string;
  readonly vulnerabilityType: string;
  readonly priorityScore: number;
  readonly rationale?: string;
}

export interface PlanModel {
  readonly planId: string;
  readonly scanId: string;
  readonly status: string;
  readonly targets: TargetModel[];
}

export interface ExploitEvidenceModel {
  readonly exploitId: string;
  readonly targetId: string;
  readonly scanId: string;
  readonly confirmed: boolean;
  readonly payload?: string;
  readonly endpoint?: string;
  readonly method?: string;
  readonly parameter?: string;
  readonly httpStatusCode?: number;
  readonly responseSnippet?: string;
  readonly verificationNotes?: string;
}

export interface PatchModel {
  readonly patchId: string;
  readonly executionId?: string;
  readonly scanId: string;
  readonly filePath: string;
  readonly diffContent: string;
  readonly status: string;
  readonly ragContextCount?: number;
  readonly explanation?: string;
}

export interface CriticValidationStage {
  readonly name: string;
  readonly status: 'IDLE' | 'RUNNING' | 'PASSED' | 'FAILED' | 'SKIPPED';
  readonly message?: string;
  readonly durationMs?: number;
}

export interface CriticResultModel {
  readonly executionId: string;
  readonly approved: boolean;
  readonly verdictMessage: string;
  readonly stages: CriticValidationStage[];
}

export interface RuntimeSandboxModel {
  readonly sandboxId: string;
  readonly status: 'PROVISIONING' | 'READY' | 'FAILED' | 'DESTROYING' | 'DESTROYED';
  readonly targetUrl?: string;
  readonly runtime: 'docker' | 'process' | string;
  readonly containerId?: string;
  readonly hostPort?: number;
  readonly healthStatus?: string;
  readonly createdAt: string;
}
