/**
 * Minimal AgentExecution record service — reuses the EXISTING Prisma
 * AgentExecution model (AgentType SCOUT/SNIPER/ENGINEER/CRITIC,
 * AgentExecutionStatus PENDING/RUNNING/COMPLETED/FAILED/TIMEOUT). No schema
 * changes, no new tables.
 *
 * Security: metadata is sanitized BEFORE persistence — sensitive keys
 * (api keys / secrets / tokens / passwords / auth) are stripped, values are
 * truncated (no huge blobs), and the record never stores raw provider
 * responses or repository content wholesale.
 */

export type AgentType = 'SCOUT' | 'SNIPER' | 'ENGINEER' | 'CRITIC';
export type AgentExecutionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';

export interface AgentExecutionInput {
  readonly scanId: string;
  readonly agentType: AgentType;
  readonly status: AgentExecutionStatus;
  /** Small structured metadata (e.g. counts, target ids). Sanitized. */
  readonly inputMetadata?: Readonly<Record<string, unknown>>;
  readonly outputMetadata?: Readonly<Record<string, unknown>>;
  readonly errorMessage?: string | null;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
}

export interface AgentExecutionRecord {
  readonly id: string;
  readonly scanId: string;
  readonly agentType: AgentType;
  readonly status: AgentExecutionStatus;
  readonly createdAt: string;
}

/** Full detail of one execution (used by GET /engineer/:executionId). */
export interface AgentExecutionDetail extends AgentExecutionRecord {
  readonly inputMetadata?: unknown;
  readonly outputMetadata?: unknown;
  readonly errorMessage?: string | null;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
}

export interface AgentExecutionRepository {
  save(input: AgentExecutionInput): Promise<AgentExecutionRecord>;
  /** Full execution row (metadata included) or null. */
  find(executionId: string): Promise<AgentExecutionDetail | null>;
}

export interface AgentExecutionService {
  /** Record a completed (or terminal) execution in one call. */
  record(input: AgentExecutionInput): Promise<AgentExecutionRecord>;
  /** Look up a recorded execution (metadata included). */
  find(executionId: string): Promise<AgentExecutionDetail | null>;
  /** Sanitize raw metadata (exported for tests + reuse). */
  sanitizeMetadata(value: unknown): unknown;
}

export const AGENT_EXECUTION_METADATA_MAX_JSON_BYTES = 8_192;
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|secret|token|password|passwd|authorization|auth[_-]?key|credential)/i;

export class DefaultAgentExecutionService implements AgentExecutionService {
  private readonly repository: AgentExecutionRepository;

  constructor(repository: AgentExecutionRepository) {
    this.repository = repository;
  }

  async record(input: AgentExecutionInput): Promise<AgentExecutionRecord> {
    const sanitized: AgentExecutionInput = {
      scanId: input.scanId,
      agentType: input.agentType,
      status: input.status,
      inputMetadata: sanitizeRecord(input.inputMetadata),
      outputMetadata: sanitizeRecord(input.outputMetadata),
      errorMessage: truncate(input.errorMessage ?? null, 2_000),
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
    };
    return this.repository.save(sanitized);
  }

  async find(executionId: string): Promise<AgentExecutionDetail | null> {
    return this.repository.find(executionId);
  }

  sanitizeMetadata(value: unknown): unknown {
    return sanitizeValue(value);
  }
}

// --- sanitization --------------------------------------------------------

function sanitizeRecord(value: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = sanitizeValue(entry);
    }
  }
  return out;
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncate(value, 1_000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(sanitizeValue);
  }
  if (typeof value === 'object') {
    return sanitizeRecord(value as Record<string, unknown>);
  }
  return '[UNSUPPORTED]';
}

function truncate(value: string | null, max: number): string | null {
  if (value === null) return null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}