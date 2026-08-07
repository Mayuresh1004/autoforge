import type { DependencyCategory } from '../../domain/models/dependencies';
import { DetectionContext } from './detection-context';

/**
 * Package-name → category rules. A dependency maps to every category whose
 * targets it matches (e.g. `next-auth` is both a framework consumer and an
 * auth library). Unmatched dependencies default to `other`.
 */
const CATEGORY_RULES: ReadonlyArray<{
  readonly category: DependencyCategory;
  readonly targets: readonly string[];
}> = [
  {
    category: 'framework',
    targets: [
      'express', 'koa', 'hapi', 'fastify', 'next', 'react', 'vue', 'svelte',
      'angular', 'nuxt', 'gatsby', 'astro', 'remix', 'nest', 'fastapi', 'flask',
      'django', 'tornado', 'gin', 'echo', 'spring', 'spring-boot', 'laravel',
      'symfony', 'actix-web', 'axum', 'rails', 'flutter',
    ],
  },
  {
    category: 'auth',
    targets: [
      'next-auth', '@auth/core', 'clerk', 'passport', 'jsonwebtoken', 'jose',
      'oauth', 'express-session', 'iron-session', 'firebase-auth', 'supabase',
      'session', 'jwt', '@supabase',
    ],
  },
  {
    category: 'security',
    targets: [
      'helmet', 'express-rate-limit', 'rate-limiter-flexible', 'csrf', 'csurf',
      'sanitize-html', 'dompurify', 'xss', 'bcrypt', 'bcryptjs', 'argon2', 'crypto-js',
    ],
  },
  {
    category: 'orm',
    targets: [
      'prisma', 'typeorm', 'sequelize', 'drizzle', 'mikro-orm', 'knex',
      'sqlalchemy', 'peewee', 'sqlmodel', 'mongoose',
    ],
  },
  {
    category: 'database',
    targets: [
      'pg', 'postgres', 'postgresql', 'mysql', 'mysql2', 'mongodb', 'sqlite3', 'better-sqlite3',
      'ioredis', 'redis', 'pymongo', 'psycopg2', 'asyncpg', 'clickhouse',
      '@qdrant/js-client-rest', 'qdrant-client', 'chromadb', 'pinecone',
      'weaviate-client', 'pgvector', 'elasticsearch', 'dynamodb',
    ],
  },
  {
    category: 'ai',
    targets: [
      'langchain', 'langgraph', 'openai', 'anthropic', 'google-genai',
      'transformers', 'torch', 'tensorflow', 'llama-index', 'ollama', 'ai',
      'mistralai',
    ],
  },
  {
    category: 'test',
    targets: [
      'jest', 'vitest', 'mocha', 'chai', 'jasmine', 'pytest', 'cypress',
      'playwright', 'supertest', 'sinon', 'nock', '@testing-library',
    ],
  },
  {
    category: 'lint',
    targets: [
      'eslint', 'prettier', '@typescript-eslint', 'ruff', 'flake8', 'mypy',
      'oxlint', 'biomejs', 'golangci-lint', 'checkstyle',
    ],
  },
  {
    category: 'validation',
    targets: ['zod', 'joi', 'yup', 'ajv', 'valibot', 'pydantic', 'class-validator', 'io-ts'],
  },
  {
    category: 'logging',
    targets: ['pino', 'winston', 'log4js', 'bunyan', 'structlog', 'loguru', 'morgan', 'consola'],
  },
  {
    category: 'http',
    targets: ['axios', 'node-fetch', 'got', 'superagent', 'httpx', 'requests', 'aiohttp', 'urllib3'],
  },
  {
    category: 'utility',
    targets: ['lodash', 'underscore', 'moment', 'dayjs', 'date-fns', 'ramda', 'dotenv', 'uuid', 'nanoid', 'axios'],
  },
];

/**
 * Classifies a fully-qualified dependency name into semantic categories.
 *
 * Falls back to matching the final coordinate segment so Maven-style
 * `group:artifactId` names classify correctly (e.g.
 * `org.springframework.boot:spring-boot-starter-web` → framework).
 */
export function classifyDependency(name: string): readonly DependencyCategory[] {
  const categories: DependencyCategory[] = [];
  for (const rule of CATEGORY_RULES) {
    if (rule.targets.some((target) => matchesTarget(name, target))) {
      categories.push(rule.category);
    }
  }
  return categories.length > 0 ? categories : ['other'];
}

function matchesTarget(name: string, target: string): boolean {
  if (DetectionContext.dependencyMatches(name, target)) return true;
  // For `group:artifact` coordinates, also test the artifact segment.
  const artifact = name.split(':').pop();
  return !!artifact && artifact !== name && DetectionContext.dependencyMatches(artifact, target);
}