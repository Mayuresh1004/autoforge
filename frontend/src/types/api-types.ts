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

export type FindingStatus =
  | 'DISCOVERED'
  | 'DETECTED'
  | 'PLANNED'
  | 'VERIFYING'
  | 'CONFIRMED'
  | 'EXPLOIT_CONFIRMED'
  | 'NOT_CONFIRMED'
  | 'NOT_TESTED'
  | 'EXPLOIT_REJECTED'
  | 'REMEDIATION'
  | 'PATCHED'
  | 'PATCH_GENERATED'
  | 'CRITIC_VERIFIED'
  | 'CRITIC_REJECTED';

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
  readonly isDemo?: boolean;
}

export interface FindingModel {
  readonly id: string;
  readonly findingId?: string;
  readonly scanId?: string;
  readonly ruleId?: string;
  readonly vulnerabilityId?: string;
  readonly type?: string;
  readonly vulnType?: string;
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
  readonly status?: FindingStatus;
  readonly isConfirmed?: boolean;
  readonly isDemo?: boolean;
  readonly patch?: {
    readonly id?: string;
    readonly patchId?: string;
    readonly filePath?: string | null;
    readonly diffContent?: string | null;
    readonly explanation?: string | null;
    readonly status?: string;
  } | null;
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
  readonly findingId?: string;
  readonly path?: string;
  readonly url?: string;
  readonly method: string;
  readonly description?: string;
  readonly evidence?: string;
  readonly status?: string;
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
  readonly findingId?: string;
  readonly scanId: string;
  readonly endpoint: string;
  readonly method: string;
  readonly vulnerabilityType: string;
  readonly priorityScore: number;
  readonly priority?: number;
  readonly status?: 'PENDING' | 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | string;
  readonly rationale?: string;
  readonly estimatedRisk?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly recommendedTool?: string;
  readonly reason?: string;
  readonly candidateVulnerabilities?: readonly string[];
  readonly verificationStatus?: string;
  readonly verificationReason?: string;
}

export interface PlanModel {
  readonly planId?: string;
  readonly scanId?: string;
  readonly status?: string;
  readonly targets: readonly TargetModel[];
}

export interface ExploitEvidenceModel {
  readonly exploitId: string;
  readonly targetId: string;
  readonly findingId?: string;
  readonly scanId: string;
  readonly confirmed: boolean;
  readonly status?: string;
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
  readonly findingId?: string;
  readonly executionId?: string;
  readonly scanId: string;
  readonly filePath: string;
  readonly diffContent: string;
  readonly status: string;
  readonly ragContextCount?: number;
  readonly explanation?: string;
  readonly prNumber?: number | null;
  readonly prUrl?: string | null;
  readonly prBranch?: string | null;
  readonly prCommitSha?: string | null;
  readonly prStatus?: string | null;
  readonly prDeliveredAt?: string | null;
  readonly prError?: string | null;
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
  readonly runtime?: 'docker' | 'process' | string;
  readonly healthStatus?: string;
  readonly id: string;
  readonly scanId: string;
  readonly status: 'PROVISIONING' | 'READY' | 'FAILED' | 'DESTROYING' | 'DESTROYED';
  readonly name?: string;
  readonly repository: {
    readonly name?: string;
    readonly url?: string;
    readonly path?: string;
  };
  readonly sandboxId?: string;
  readonly imageName?: string;
  readonly networkId?: string;
  readonly targetUrl?: string;
  readonly internalHost?: string;
  readonly internalPort?: number;
  readonly exposedPort?: number;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly destroyedAt?: string;
  readonly failureStage?: string;
  readonly failureReason?: string;
}

export interface SniperRunReportModel {
  readonly runId: string;
  readonly scanId: string;
  readonly sandboxId: string;
  readonly results: readonly {
    readonly targetId: string;
    readonly exploit: {
      readonly exploitId: string;
      readonly targetId: string;
      readonly scanId: string;
      readonly status: string;
      readonly confirmed: boolean;
      readonly payload?: string;
      readonly endpoint?: string;
      readonly method?: string;
      readonly parameter?: string;
      readonly httpStatusCode?: number;
      readonly responseSnippet?: string;
      readonly verificationNotes?: string;
    };
  }[];
  readonly completed: number;
  readonly total: number;
}
