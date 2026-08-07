import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Required env vars so config/index.ts can load in tests that import
    // modules with config side effects (logger, analyzerConfig, ...).
    env: {
      DATABASE_URL: 'postgresql://amass:amass@localhost:5432/amass_test',
      REDIS_URL: 'redis://localhost:6379',
      LOG_LEVEL: 'fatal',
    },
  },
});
