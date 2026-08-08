export type ScoutStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

/** Declarative summary of a completed recon run. */
export interface ScoutSummary {
  readonly ports: number;
  readonly services: number;
  readonly endpoints: number;
  readonly forms: number;
  readonly adminPanels: number;
  readonly graphql: boolean;
  readonly websockets: number;
  readonly technologies: number;
}

export const EMPTY_SCOUT_SUMMARY: ScoutSummary = {
  ports: 0,
  services: 0,
  endpoints: 0,
  forms: 0,
  adminPanels: 0,
  graphql: false,
  websockets: 0,
  technologies: 0,
};

/** Persistent record of one Scout recon run. */
export interface ScoutScanRecord {
  readonly id: string;
  /** The source static-scan this recon is attached to. */
  readonly scanId: string;
  readonly targetUrl: string;
  readonly status: ScoutStatus;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly summary: ScoutSummary | null;
  readonly createdAt: Date;
}