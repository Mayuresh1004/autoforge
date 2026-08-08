import { promises as fs } from 'node:fs';
import path from 'node:path';
import { UnsupportedRuntimeError } from '../../domain/errors/runtime-sandbox.errors';
import type { RuntimeConfig, RuntimeStrategy } from '../../domain/value-objects/runtime-config';
import {
  DOCKERFILE_DEFAULT_PORT,
  DEFAULT_HEALTH_PATH,
  NODE_DEFAULT_PORT,
  PYTHON_DEFAULT_PORT,
} from '../../domain/value-objects/runtime-config';

export interface ResolvedRuntimeConfig {
  readonly config: RuntimeConfig;
  /** Mode 2 generated Dockerfile (written into the workspace for the build). */
  readonly generatedDockerfile?: string;
}

const PYTHON_ENTRYPOINTS = ['app.py', 'main.py', 'server.py', 'wsgi.py', 'run.py'];

function pythonDockerfile(install: boolean, entrypoint: string, port: number): string {
  const lines = [
    'FROM python:3.11-slim',
    'ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1',
    'WORKDIR /app',
    'COPY . /app',
  ];
  if (install) lines.push('RUN pip install --no-cache-dir -r requirements.txt');
  lines.push(`EXPOSE ${port}`, `CMD ["python", "${entrypoint}"]`);
  return lines.join('\n');
}

function nodeDockerfile(port: number): string {
  return [
    'FROM node:20-alpine',
    'WORKDIR /app',
    'COPY package*.json ./',
    'RUN npm install --omit=dev --no-audit --no-fund',
    'COPY . .',
    `EXPOSE ${port}`,
    'CMD ["npm", "start"]',
  ].join('\n');
}

/**
 * Deterministic, bounded strategy resolution (Mode 1 = repository's own
 * Dockerfile; Mode 2 = fixed templates for python/node). Anything else fails
 * fast with an explicit UNSUPPORTED_RUNTIME result — no ad-hoc runtime was
 * ever built.
 */
export async function resolveRuntimeConfig(
  repoPath: string,
  portOverride?: number
): Promise<ResolvedRuntimeConfig> {
  const files = await listEntryFiles(repoPath);

  // Mode 1 — repository-provided Dockerfile.
  const dockerfile = findDockerfile(files);
  if (dockerfile) {
    const raw = await fs.readFile(path.join(repoPath, dockerfile), 'utf8').catch(() => '');
    if (!raw.trim()) throw new UnsupportedRuntimeError([`${dockerfile} is empty`]);
    return {
      config: {
        strategy: 'DOCKERFILE',
        dockerfile: { path: dockerfile },
        command: [],
        port: portOverride ?? DOCKERFILE_DEFAULT_PORT,
        healthPath: DEFAULT_HEALTH_PATH,
      },
    };
  }

  // Mode 2 — python: entrypoint file or dependency manifest present.
  const pythonEntrypoint =
    PYTHON_ENTRYPOINTS.find((name) => files.includes(name)) ??
    (files.includes('requirements.txt') || files.includes('pyproject.toml') ? 'app.py' : undefined);
  if (pythonEntrypoint) {
    const port = portOverride ?? PYTHON_DEFAULT_PORT;
    return {
      config: {
        strategy: 'PYTHON',
        recipe: {
          baseImage: 'python:3.11-slim',
          installSteps: files.includes('requirements.txt')
            ? ['pip install --no-cache-dir -r requirements.txt']
            : [],
        },
        command: [],
        port,
        healthPath: DEFAULT_HEALTH_PATH,
      },
      generatedDockerfile: pythonDockerfile(files.includes('requirements.txt'), pythonEntrypoint, port),
    };
  }

  // Mode 2 — node: package.json with a start script.
  if (files.includes('package.json')) {
    const manifest = await fs.readFile(path.join(repoPath, 'package.json'), 'utf8').catch(() => null);
    if (manifest === null) throw new UnsupportedRuntimeError(['package.json unreadable']);
    try {
      const parsed = JSON.parse(manifest) as { scripts?: Record<string, string> };
      if (typeof parsed.scripts?.start !== 'string') {
        throw new UnsupportedRuntimeError(['package.json without a start script']);
      }
    } catch (error) {
      if (error instanceof UnsupportedRuntimeError) throw error;
      throw new UnsupportedRuntimeError(['package.json is not valid JSON']);
    }
    const port = portOverride ?? NODE_DEFAULT_PORT;
    return {
      config: {
        strategy: 'NODE',
        recipe: {
          baseImage: 'node:20-alpine',
          installSteps: ['npm install --omit=dev --no-audit --no-fund'],
        },
        command: [],
        port,
        healthPath: DEFAULT_HEALTH_PATH,
      },
      generatedDockerfile: nodeDockerfile(port),
    };
  }

  throw new UnsupportedRuntimeError(files.slice(0, 4));
}

export function strategyLabel(strategy: RuntimeStrategy): string {
  return strategy === 'DOCKERFILE' ? 'Mode 1 (repo Dockerfile)' : 'Mode 2 (generated)';
}

// -- internals ---------------------------------------------------------------

async function listEntryFiles(repoPath: string): Promise<readonly string[]> {
  const entries = await fs.readdir(repoPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function findDockerfile(files: readonly string[]): string | null {
  if (files.includes('Dockerfile')) return 'Dockerfile';
  return files.find((name) => /^dockerfile(?:\..+)?$/i.test(name)) ?? null;
}