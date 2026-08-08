import { z } from 'zod';
import os from 'node:os';
import path from 'node:path';

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
