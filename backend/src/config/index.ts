import { z } from 'zod';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import type { LLMProviderConfig } from '../llm/domain/ports/llm-config';

// Load environment variables from process.cwd()/.env and monorepo root .env if available
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
import type { LLMProviderId } from '../llm/domain/ports/llm-provider';
import { LLM_PROVIDER_IDS } from '../llm/domain/ports/llm-provider';
import type { EmbeddingConfig } from '../embedding/domain/ports/embedding-provider';

const emptyToUndefined = (val: unknown) =>
  typeof val === 'string' && val.trim() === '' ? undefined : val;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_NAME: z.string().default('AMASS'),
  APP_VERSION: z.string().default('0.1.0'),

  BACKEND_HOST: z.string().default('0.0.0.0'),
  BACKEND_PORT: z.coerce.number().default(3001),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_URL: z.string().optional(),
  REDIS_PREFIX_AMASS: z.string().default('amass:'),
  REDIS_TTL_CACHE: z.coerce.number().default(3600),

  QDRANT_HOST: z.string().default('localhost'),
  QDRANT_PORT: z.coerce.number().default(6333),
  QDRANT_URL: z.string().optional(),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION_NAME: z.string().default('amass_embeddings'),

  // Engineer agent (Phase 7B) bounds
  ENGINEER_MAX_SOURCE_BYTES: z.coerce.number().int().positive().default(64_000),
  ENGINEER_MAX_CONTEXT_LINES: z.coerce.number().int().positive().default(150),
  ENGINEER_DEFAULT_CONTEXT_WINDOW: z.coerce.number().int().positive().default(12),
  ENGINEER_MAX_DIFF_CHARS: z.coerce.number().int().positive().default(16_000),
  ENGINEER_MAX_PATCH_FILES: z.coerce.number().int().min(1).max(10).default(3),
  ENGINEER_RAG_TOP_K: z.coerce.number().int().min(1).max(50).default(4),

  // Critic agent (Phase 8) bounds + retry loop
  CRITIC_MAX_PATCH_BYTES: z.coerce.number().int().positive().default(16_000),
  CRITIC_MAX_SOURCE_BYTES: z.coerce.number().int().positive().default(64_000),
  CRITIC_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  CRITIC_TEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  CRITIC_RETEST_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  CRITIC_ADVISORY_ENABLED: z.enum(['true', 'false']).default('true'),
  CRITIC_MAX_ENGINEER_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

  AGENTS_URL: z.string().default('http://localhost:8000'),

  ANALYZER_WORKSPACE_DIR: z.string().optional(),
  ANALYZER_CLONE_TIMEOUT_MS: z.coerce.number().default(120_000),
  ANALYZER_MAX_REPO_BYTES: z.coerce.number().default(2_147_483_648),
  ANALYZER_KEEP_REPO_DIR: z.enum(['true', 'false']).default('false'),

  SCANNER_DEFAULT_TIMEOUT_MS: z.coerce.number().default(60_000),
  STATIC_SCAN_RUNTIME: z.enum(['classic', 'sandboxed']).default('sandboxed'),
  SCANNER_SEVERITY_THRESHOLD: z
    .enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
    .default('INFO'),
  SCANNER_BANDIT_ENABLED: z.enum(['true', 'false']).default('true'),
  SCANNER_BANDIT_TIMEOUT_MS: z.coerce.number().optional(),
  SCANNER_BANDIT_ARGS: z.string().optional(),
  SCANNER_SEMGREP_ENABLED: z.enum(['true', 'false']).default('true'),
  SCANNER_SEMGREP_TIMEOUT_MS: z.coerce.number().optional(),
  SCANNER_SEMGREP_ARGS: z.string().optional(),
  SCANNER_NPM_AUDIT_ENABLED: z.enum(['true', 'false']).default('true'),
  SCANNER_NPM_AUDIT_TIMEOUT_MS: z.coerce.number().optional(),
  SCANNER_NPM_AUDIT_ARGS: z.string().optional(),
  SCANNER_PIP_AUDIT_ENABLED: z.enum(['true', 'false']).default('true'),
  SCANNER_PIP_AUDIT_TIMEOUT_MS: z.coerce.number().optional(),
  SCANNER_PIP_AUDIT_ARGS: z.string().optional(),

  SCOUT_TIMEOUT_MS: z.coerce.number().default(180_000),
  SCOUT_MAX_PAGES: z.coerce.number().default(100),
  SCOUT_MAX_DEPTH: z.coerce.number().default(3),
  SCOUT_PROBE_TIMEOUT_MS: z.coerce.number().default(5_000),
  SCOUT_PORT_SCAN_ENABLED: z.enum(['true', 'false']).default('true'),
  SCOUT_PROBE_COMMON_PATHS: z.enum(['true', 'false']).default('true'),

  // --- Sniper Agent (exploit verification) ---
  // Hard timeout for ONE verification attempt (sqlmap run).
  SNIPER_ATTEMPT_TIMEOUT_MS: z.coerce.number().default(120_000),
  // Upper bound of retries for transient failures (tool crash, timeout,
  // sandbox/network issues). Confirmed / non-vulnerable verdicts never retry.
  SNIPER_MAX_ATTEMPTS: z.coerce.number().default(2),
  // Bounded concurrency across planned targets (never unlimited).
  SNIPER_CONCURRENCY: z.coerce.number().default(2),
  // Delay between retried attempts (ms).
  SNIPER_RETRY_DELAY_MS: z.coerce.number().default(1_500),
  // Max stored stdout/stderr summary bytes per attempt (truncated + redacted).
  SNIPER_STORE_SUMMARY_BYTES: z.coerce.number().default(4_000),
  // Max tool output line count kept in memory while parsing.
  SNIPER_MAX_OUTPUT_LINES: z.coerce.number().default(2_000),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // --- Runtime Sandbox Lifecycle (Phase 6) ---
  // Every limit below is bounded by design — nothing may be unlimited.
  SANDBOX_CPU_LIMIT: z.coerce.number().min(0.01).max(16).default(0.5),
  SANDBOX_MEMORY_LIMIT: z.string().regex(/^\d+[kKmMgG]$/, 'SANDBOX_MEMORY_LIMIT must look like 512m').default('512m'),
  SANDBOX_PIDS_LIMIT: z.coerce.number().int().min(16).max(65536).default(256),
  /** Overall runtime-sandbox lifetime before it is expired/reclaimed. */
  SANDBOX_TIMEOUT: z.coerce.number().min(60_000).max(24 * 3600_000).default(1_800_000),
  SANDBOX_BUILD_TIMEOUT: z.coerce.number().min(30_000).default(300_000),
  SANDBOX_START_TIMEOUT: z.coerce.number().min(10_000).default(60_000),
  SANDBOX_HEALTH_TIMEOUT: z.coerce.number().min(1_000).default(30_000),
  SANDBOX_MAX_CONCURRENT: z.coerce.number().int().min(1).max(64).default(3),
  /** Localhost-only host port publishing is disabled unless explicitly enabled. */
  SANDBOX_ALLOW_HOST_EXPOSE: z.enum(['true', 'false']).default('false'),

  // --- Observability / event stream (Phase 9) ---
  EVENTS_HEARTBEAT_MS: z.coerce.number().int().min(1_000).default(15_000),
  EVENTS_SSE_BUFFER_LINES: z.coerce.number().int().min(10).max(10_000).default(200),
  EVENTS_RING_PER_SCAN: z.coerce.number().int().min(10).max(10_000).default(200),
  EVENTS_MAX_SCANS: z.coerce.number().int().min(1).max(10_000).default(100),
  EVENTS_METADATA_MAX_BYTES: z.coerce.number().int().min(256).max(64_000).default(2_048),
  EVENTS_MESSAGE_MAX_CHARS: z.coerce.number().int().min(80).max(4_000).default(300),
  EVENTS_ENDPOINT_CAP: z.coerce.number().int().min(1).max(1_000).default(50),

  // --- LLM provider (free-first) ---
  // Preferred order: gemini → openrouter → groq → mistral. No paid provider
  // is required; only the configured provider(s) need keys.
  LLM_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(['gemini', 'openrouter', 'groq', 'mistral']).default('gemini')
  ),
  // Explicit primary override (takes precedence over LLM_PROVIDER when set).
  LLM_PRIMARY_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(['gemini', 'openrouter', 'groq', 'mistral']).optional()
  ),
  // Default model: EMPTY by default — resolved provider-aware at build time
  // (MEDIUM-5). Only OpenRouter gets the 'openrouter/free' routing alias for
  // free; non-openrouter providers require an explicit LLM_MODEL or
  // *_MODEL, so the old default (provider=gemini + model=openrouter/free)
  // can never silently misconfigure a paid/default provider.
  LLM_MODEL: z.string().default(''),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  LLM_MAX_TOKENS: z.coerce.number().int().min(1).max(128_000).default(4096),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  // Comma-separated escalation order after the primary (e.g. "groq,mistral").
  LLM_FALLBACK_PROVIDERS: z.string().default(''),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  MISTRAL_MODEL: z.string().optional(),

  // --- Embeddings + knowledge/RAG (free-first; independent of the LLM axis) ---
  // Embedding provider is a SEPARATE configuration line from LLM providers.
  EMBEDDING_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(['gemini', 'noop']).default('noop')
  ),
  EMBEDDING_MODEL: z.string().default('text-embedding-004'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(64).max(8192).default(768),

  KNOWLEDGE_QDRANT_URL: z.string().optional(),
  KNOWLEDGE_QDRANT_API_KEY: z.string().optional(),
  KNOWLEDGE_QDRANT_COLLECTION: z
    .string()
    .default('amass_security_knowledge'),
  KNOWLEDGE_QDRANT_TIMEOUT_MS: z
    .coerce.number()
    .int()
    .min(1_000)
    .max(120_000)
    .default(15_000),

  KNOWLEDGE_NVD_BASE_URL: z
    .string()
    .url()
    .default('https://services.nvd.nist.gov/rest/json/cves/2.0'),
  KNOWLEDGE_NVD_PAGE_SIZE: z.coerce.number().int().min(1).max(2000).default(200),
  KNOWLEDGE_NVD_MAX_PAGES: z.coerce.number().int().min(1).max(200).default(5),
  KNOWLEDGE_NVD_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  KNOWLEDGE_NVD_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  KNOWLEDGE_NVD_RETRY_DELAY_MS: z
    .coerce.number()
    .int()
    .min(0)
    .max(60_000)
    .default(1_000),

  RAG_TOP_K_MAX: z.coerce.number().int().min(1).max(100).default(50),
  RAG_DEFAULT_TOP_K: z.coerce.number().int().min(1).max(100).default(5),
  PROMPTS_ROOT: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  return result.data;
}

export const config = loadConfig();

export interface EventsConfig {
  /** SSE heartbeat interval (comment frames keep proxies alive). */
  readonly heartbeatMs: number;
  /** Bounded per-connection SSE buffer; overflow drops the connection. */
  readonly sseBufferLines: number;
  /** Bounded in-memory event ring retained per scan (replay window). */
  readonly ringPerScan: number;
  /** Max tracked scans before the least-recently-published scan is evicted. */
  readonly maxScans: number;
  /** Hard cap on the serialized metadata payload (bytes). */
  readonly metadataMaxBytes: number;
  /** Truncation cap for the human-readable message. */
  readonly messageMaxChars: number;
  /** Per-run cap on SCOUT_ENDPOINT_DISCOVERED events (avoid flooding). */
  readonly endpointCap: number;
}

export const eventsConfig: EventsConfig = {
  heartbeatMs: config.EVENTS_HEARTBEAT_MS,
  sseBufferLines: config.EVENTS_SSE_BUFFER_LINES,
  ringPerScan: config.EVENTS_RING_PER_SCAN,
  maxScans: config.EVENTS_MAX_SCANS,
  metadataMaxBytes: config.EVENTS_METADATA_MAX_BYTES,
  messageMaxChars: config.EVENTS_MESSAGE_MAX_CHARS,
  endpointCap: config.EVENTS_ENDPOINT_CAP,
};

export const redisConfig = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
  url: config.REDIS_URL ?? `redis://:${config.REDIS_PASSWORD}@${config.REDIS_HOST}:${config.REDIS_PORT}`,
  prefix: config.REDIS_PREFIX_AMASS,
  ttl: {
    cache: config.REDIS_TTL_CACHE,
  },
};

export const qdrantConfig = {
  host: config.QDRANT_HOST,
  port: config.QDRANT_PORT,
  url: config.QDRANT_URL ?? `http://${config.QDRANT_HOST}:${config.QDRANT_PORT}`,
  apiKey: config.QDRANT_API_KEY,
  collectionName: config.QDRANT_COLLECTION_NAME,
};

export const agentsConfig = {
  url: config.AGENTS_URL,
};

export const analyzerConfig = {
  workspaceDir:
    config.ANALYZER_WORKSPACE_DIR ?? path.join(os.tmpdir(), 'amass', 'repositories'),
  cloneTimeoutMs: config.ANALYZER_CLONE_TIMEOUT_MS,
  maxRepoBytes: config.ANALYZER_MAX_REPO_BYTES,
  keepRepoDir: config.ANALYZER_KEEP_REPO_DIR === 'true',
};

function scannerEnabled(value: 'true' | 'false'): boolean {
  return value === 'true';
}

function scannerArgsParser(raw: string | undefined): string[] {
  return raw ? raw.split(/\s+/).filter((a) => a.length > 0) : [];
}

export interface ScannerConfigEntry {
  readonly enabled: boolean;
  readonly timeoutMs?: number;
  readonly extraArgs: readonly string[];
}

export interface StaticScannerConfig {
  readonly defaultTimeoutMs: number;
  readonly severityThreshold: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** 'classic' = preparer-cloned `ScanService`; 'sandboxed' = manager sandbox. */
  readonly runtime: 'classic' | 'sandboxed';
  readonly scanners: Record<'bandit' | 'semgrep' | 'npmAudit' | 'pipAudit', ScannerConfigEntry>;
}

export interface ScoutConfig {
  readonly timeoutMs: number;
  readonly maxPages: number;
  readonly maxDepth: number;
  readonly probeTimeoutMs: number;
  readonly portScanEnabled: boolean;
  readonly probeCommonPaths: boolean;
}

/**
 * Sniper Agent configuration. Every exploit verification is bounded: attempts
 * have a hard timeout, transient failures retry at most `maxAttempts` times
 * and only a bounded number of planned targets run concurrently.
 */
export interface SniperConfig {
  readonly attemptTimeoutMs: number;
  readonly maxAttempts: number;
  readonly concurrency: number;
  readonly retryDelayMs: number;
  /** Truncation cap for output persisted to the database. */
  readonly storeSummaryBytes: number;
  readonly maxOutputLines: number;
}

export const sniperConfig: SniperConfig = {
  attemptTimeoutMs: config.SNIPER_ATTEMPT_TIMEOUT_MS,
  maxAttempts: config.SNIPER_MAX_ATTEMPTS,
  concurrency: config.SNIPER_CONCURRENCY,
  retryDelayMs: config.SNIPER_RETRY_DELAY_MS,
  storeSummaryBytes: config.SNIPER_STORE_SUMMARY_BYTES,
  maxOutputLines: config.SNIPER_MAX_OUTPUT_LINES,
};

export const scoutConfig: ScoutConfig = {
  timeoutMs: config.SCOUT_TIMEOUT_MS,
  maxPages: config.SCOUT_MAX_PAGES,
  maxDepth: config.SCOUT_MAX_DEPTH,
  probeTimeoutMs: config.SCOUT_PROBE_TIMEOUT_MS,
  portScanEnabled: config.SCOUT_PORT_SCAN_ENABLED === 'true',
  probeCommonPaths: config.SCOUT_PROBE_COMMON_PATHS === 'true',
};

export interface RuntimeSandboxConfig {
  /** Hard ceiling on concurrently live runtime sandboxes (never unlimited). */
  readonly maxConcurrent: number;
  /** Lifetime before a sandbox is expired and reclaimed. */
  readonly lifetimeMs: number;
  readonly buildTimeoutMs: number;
  readonly startTimeoutMs: number;
  readonly healthTimeoutMs: number;
  /** Host-exposure (localhost-only publish) requires explicit opt-in. */
  readonly allowHostExpose: boolean;
  /** CPU/memory/PID envelope applied to every runtime container. */
  readonly limits: import('../sandbox/domain/value-objects/runtime-config').ResourceLimits;
  /** Backend used to provision containers ('docker' | 'process'). */
  readonly runtime: 'docker' | 'process';
}

export const runtimeSandboxConfig: RuntimeSandboxConfig = {
  maxConcurrent: config.SANDBOX_MAX_CONCURRENT,
  lifetimeMs: config.SANDBOX_TIMEOUT,
  buildTimeoutMs: config.SANDBOX_BUILD_TIMEOUT,
  startTimeoutMs: config.SANDBOX_START_TIMEOUT,
  healthTimeoutMs: config.SANDBOX_HEALTH_TIMEOUT,
  allowHostExpose: config.SANDBOX_ALLOW_HOST_EXPOSE === 'true',
  limits: {
    cpus: config.SANDBOX_CPU_LIMIT,
    memory: config.SANDBOX_MEMORY_LIMIT,
    pids: config.SANDBOX_PIDS_LIMIT,
  },
  runtime: (process.env.SANDBOX_RUNTIME as 'docker' | 'process' | undefined) ?? 'docker',
};

// ---------------------------------------------------------------------------
// LLM provider (free-first). Parsing happens here; provider construction is
// lazy (the factory) so the backend boots even when no key is configured.
// ---------------------------------------------------------------------------
function parseProviderList(raw: string): LLMProviderId[] {
  const ids = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const supported = new Set<string>(LLM_PROVIDER_IDS);
  for (const id of ids) {
    if (!supported.has(id)) {
      throw new Error(`LLM_FALLBACK_PROVIDERS contains unsupported provider: ${id}`);
    }
  }
  return ids as LLMProviderId[];
}

/** OpenRouter's free routing alias — configured as a default model only for
 *  the OpenRouter provider (provider-aware defaults; MEDIUM-5). */
export const OPENROUTER_FREE_ALIAS = 'openrouter/free';

/**
 * Provider-aware default model (MEDIUM-5): an explicit LLM_MODEL / *_MODEL
 * always wins; otherwise only OpenRouter falls back to its free routing
 * alias. Every other provider resolves to an empty model so the factory can
 * fail with a clear, lazy configuration error instead of pairing a wrong
 * default model (the old gemini + 'openrouter/free' mismatch).
 */
export function resolveDefaultLLMModel(provider: LLMProviderId, explicit: string): string {
  if (explicit) return explicit;
  return provider === 'openrouter' ? OPENROUTER_FREE_ALIAS : '';
}

export const llmConfig: LLMProviderConfig = {
  provider: config.LLM_PRIMARY_PROVIDER ?? config.LLM_PROVIDER,
  model: resolveDefaultLLMModel(config.LLM_PRIMARY_PROVIDER ?? config.LLM_PROVIDER, config.LLM_MODEL),
  temperature: config.LLM_TEMPERATURE,
  maxTokens: config.LLM_MAX_TOKENS,
  timeoutMs: config.LLM_TIMEOUT_MS,
  maxRetries: config.LLM_MAX_RETRIES,
  fallbackProviders: parseProviderList(config.LLM_FALLBACK_PROVIDERS),
  apiKeys: {
    gemini: config.GEMINI_API_KEY,
    openrouter: config.OPENROUTER_API_KEY,
    groq: config.GROQ_API_KEY,
    mistral: config.MISTRAL_API_KEY,
  },
  modelOverrides: {
    gemini: config.GEMINI_MODEL,
    openrouter: config.OPENROUTER_MODEL,
    groq: config.GROQ_MODEL,
    mistral: config.MISTRAL_MODEL,
  },
};

// ---------------------------------------------------------------------------
// Embeddings + knowledge/RAG (free-first; independent of the LLM axis).
// ---------------------------------------------------------------------------
export const embeddingConfig: EmbeddingConfig = {
  provider:
    config.EMBEDDING_PROVIDER === 'gemini' && !config.GEMINI_API_KEY
      ? 'noop'
      : config.EMBEDDING_PROVIDER,
  model: config.EMBEDDING_MODEL,
  dimensions: config.EMBEDDING_DIMENSIONS,
  apiKey: config.GEMINI_API_KEY,
  timeoutMs: 30_000,
  maxRetries: 2,
};

export const knowledgeConfig = {
  qdrant: {
    baseUrl: config.KNOWLEDGE_QDRANT_URL ?? qdrantConfig.url,
    apiKey: config.KNOWLEDGE_QDRANT_API_KEY,
    timeoutMs: config.KNOWLEDGE_QDRANT_TIMEOUT_MS,
    collection: config.KNOWLEDGE_QDRANT_COLLECTION,
  },
  nvd: {
    baseUrl: config.KNOWLEDGE_NVD_BASE_URL,
    pageSize: config.KNOWLEDGE_NVD_PAGE_SIZE,
    maxPages: config.KNOWLEDGE_NVD_MAX_PAGES,
    timeoutMs: config.KNOWLEDGE_NVD_TIMEOUT_MS,
    maxRetries: config.KNOWLEDGE_NVD_MAX_RETRIES,
    retryDelayMs: config.KNOWLEDGE_NVD_RETRY_DELAY_MS,
  },
};

export const ragConfig = {
  topKMax: config.RAG_TOP_K_MAX,
  defaultTopK: config.RAG_DEFAULT_TOP_K,
};

export const promptsConfig = {
  root: config.PROMPTS_ROOT,
};

export const engineerConfig = {
  maxSourceBytes: config.ENGINEER_MAX_SOURCE_BYTES,
  maxContextLines: config.ENGINEER_MAX_CONTEXT_LINES,
  defaultContextWindow: config.ENGINEER_DEFAULT_CONTEXT_WINDOW,
  bounds: {
    maxDiffChars: config.ENGINEER_MAX_DIFF_CHARS,
    maxPatchFiles: config.ENGINEER_MAX_PATCH_FILES,
    maxExplanationChars: 1_200,
    maxAssumptions: 8,
  },
  ragTopK: config.ENGINEER_RAG_TOP_K,
};

export const criticConfig = {
  maxPatchBytes: config.CRITIC_MAX_PATCH_BYTES,
  maxSourceBytes: config.CRITIC_MAX_SOURCE_BYTES,
  checkTimeoutMs: config.CRITIC_CHECK_TIMEOUT_MS,
  testTimeoutMs: config.CRITIC_TEST_TIMEOUT_MS,
  retestTimeoutMs: config.CRITIC_RETEST_TIMEOUT_MS,
  advisoryEnabled: config.CRITIC_ADVISORY_ENABLED === 'true',
  maxEngineerRetries: config.CRITIC_MAX_ENGINEER_RETRIES,
};

export const staticScannerConfig: StaticScannerConfig = {
  defaultTimeoutMs: config.SCANNER_DEFAULT_TIMEOUT_MS,
  severityThreshold: config.SCANNER_SEVERITY_THRESHOLD,
  runtime: config.STATIC_SCAN_RUNTIME,
  scanners: {
    bandit: {
      enabled: scannerEnabled(config.SCANNER_BANDIT_ENABLED),
      timeoutMs: config.SCANNER_BANDIT_TIMEOUT_MS,
      extraArgs: scannerArgsParser(config.SCANNER_BANDIT_ARGS),
    },
    semgrep: {
      enabled: scannerEnabled(config.SCANNER_SEMGREP_ENABLED),
      timeoutMs: config.SCANNER_SEMGREP_TIMEOUT_MS,
      extraArgs: scannerArgsParser(config.SCANNER_SEMGREP_ARGS),
    },
    npmAudit: {
      enabled: scannerEnabled(config.SCANNER_NPM_AUDIT_ENABLED),
      timeoutMs: config.SCANNER_NPM_AUDIT_TIMEOUT_MS,
      extraArgs: scannerArgsParser(config.SCANNER_NPM_AUDIT_ARGS),
    },
    pipAudit: {
      enabled: scannerEnabled(config.SCANNER_PIP_AUDIT_ENABLED),
      timeoutMs: config.SCANNER_PIP_AUDIT_TIMEOUT_MS,
      extraArgs: scannerArgsParser(config.SCANNER_PIP_AUDIT_ARGS),
    },
  },
};
