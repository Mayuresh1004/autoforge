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
 *
 * Mode 1 nuance: a Dockerfile WITHOUT its own `CMD` inherits the base image's
 * default CMD (often a REPL/entrypoint that exits immediately — e.g.
 * `node`). When no CMD is declared, the start command is derived from the
 * repository's own stack (the same deterministic detection Mode 2 uses), so
 * a command-less Dockerfile still runs the app instead of exiting.
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
        // Image CMD governs when declared; otherwise derive a stack-aware
        // start command (e.g. NodeGoat's Dockerfile ships no CMD and its
        // compose runs `npm start`).
        command: hasDockerfileCmd(raw) ? [] : await stackStartCommand(files, repoPath),
        port: portOverride ?? DOCKERFILE_DEFAULT_PORT,
        healthPath: DEFAULT_HEALTH_PATH,
      },
    };
  }

  // Mode 2 — python: entrypoint file or dependency manifest present.
  const pythonEntrypoint = pythonEntrypointFrom(files);
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

/** The repository declares its own `CMD` (any stage) → the image CMD governs. */
function hasDockerfileCmd(raw: string): boolean {
  // A comment line can never match: it starts with '#' before 'CMD'.
  return /^[ \t]*CMD\b/m.test(raw);
}

/** Shared python-entrypoint detection (Mode 2 + Mode 1 no-CMD fallback). */
function pythonEntrypointFrom(files: readonly string[]): string | undefined {
  return (
    PYTHON_ENTRYPOINTS.find((name) => files.includes(name)) ??
    (files.includes('requirements.txt') || files.includes('pyproject.toml') ? 'app.py' : undefined)
  );
}

/**
 * Deterministic stack-aware start command for a repo, used when a Mode-1
 * Dockerfile ships no CMD. Mirrors Mode 2's detection exactly (python
 * entrypoint / package.json start script); returns [] when the stack is not
 * recognizable — the container then runs the image default and the health
 * check surfaces the failure.
 */
async function stackStartCommand(
  files: readonly string[],
  repoPath: string
): Promise<readonly string[]> {
  const pythonEntrypoint = pythonEntrypointFrom(files);
  if (pythonEntrypoint) return ['python', pythonEntrypoint];
  if (files.includes('package.json')) {
    const manifest = await fs.readFile(path.join(repoPath, 'package.json'), 'utf8').catch(() => null);
    if (manifest !== null) {
      try {
        const parsed = JSON.parse(manifest) as { scripts?: Record<string, string> };
        if (typeof parsed.scripts?.start === 'string') return ['npm', 'start'];
      } catch {
        /* unparseable manifest → no fallback command */
      }
    }
  }
  return [];
}