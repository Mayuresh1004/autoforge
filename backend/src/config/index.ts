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
