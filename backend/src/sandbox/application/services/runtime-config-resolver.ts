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

interface PythonTarget {
  readonly entrypoint: string;
  readonly requirementsPath?: string;
}

interface NodeTarget {
  readonly packageJsonPath: string;
  readonly startScript: string;
}

function pythonDockerfile(target: PythonTarget, port: number): string {
  const lines = [
    'FROM python:3.11-slim',
    'ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1',
    'ENV GITHUB_WEBHOOK_SECRET=amass_runtime_dev_secret',
    'ENV SUPABASE_URL=http://localhost:54321',
    'ENV SUPABASE_SERVICE_ROLE_KEY=amass_runtime_dev_service_key',
    'ENV REDIS_URL=redis://localhost:6379',
    'ENV GEMINI_API_KEY=amass_runtime_dev_gemini_key',
  ];

  const entryDir = path.dirname(target.entrypoint).replace(/\\/g, '/');
  const pythonPaths = ['/app'];
  if (entryDir && entryDir !== '.') {
    const parentDir = path.dirname(entryDir).replace(/\\/g, '/');
    if (parentDir && parentDir !== '.') {
      pythonPaths.push(`/app/${parentDir}`);
    } else {
      pythonPaths.push(`/app/${entryDir}`);
    }
  }
  lines.push(`ENV PYTHONPATH=${pythonPaths.join(':')}`);
  lines.push('WORKDIR /app', 'COPY . /app');

  if (target.requirementsPath) {
    lines.push(`RUN pip install --no-cache-dir --default-timeout=100 -r ${target.requirementsPath}`);
  }

  lines.push(`EXPOSE ${port}`);

  const p = target.entrypoint.replace(/\\/g, '/');
  if (p.includes('/')) {
    const runnerScript = `import sys, os, importlib; p = '${p}'; d = os.path.dirname(p); sys.path.insert(0, '/app'); sys.path.insert(0, '/app/' + os.path.dirname(d) if '/' in d else '/app/' + d); m = os.path.splitext(p)[0].replace('/', '.'); mod = importlib.import_module(m); (importlib.import_module('uvicorn').run(mod.app, host='0.0.0.0', port=${port}) if hasattr(mod, 'app') else (exec(open(p).read())))`;
    lines.push(`CMD ["python", "-c", "${runnerScript}"]`);
  } else {
    lines.push(`CMD ["python", "${p}"]`);
  }
  return lines.join('\n');
}

function nodeDockerfile(target: NodeTarget, port: number): string {
  const dir = path.dirname(target.packageJsonPath).replace(/\\/g, '/');
  if (dir === '.') {
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

  return [
    'FROM node:20-alpine',
    'WORKDIR /app',
    'COPY . .',
    `RUN cd ${dir} && npm install --omit=dev --no-audit --no-fund`,
    `EXPOSE ${port}`,
    `CMD ["npm", "start", "--prefix", "${dir}"]`,
  ].join('\n');
}

/**
 * Deterministic, bounded strategy resolution based on strong evidence hierarchy:
 * 1. Package manifests / lockfiles & entrypoints (Python / Node)
 * 2. Mode 1 repository-provided Dockerfile
 * 3. Fallback explicit README instructions
 */
export async function resolveRuntimeConfig(
  repoPath: string,
  portOverride?: number
): Promise<ResolvedRuntimeConfig> {
  const files = await listAllFiles(repoPath);

  // Mode 1 — repository-provided Dockerfile.
  const dockerfile = findDockerfile(files);
  if (dockerfile) {
    const raw = await fs.readFile(path.join(repoPath, dockerfile), 'utf8').catch(() => '');
    if (!raw.trim()) throw new UnsupportedRuntimeError([`${dockerfile} is empty`]);
    return {
      config: {
        strategy: 'DOCKERFILE',
        dockerfile: { path: dockerfile },
        command: hasDockerfileCmd(raw) ? [] : await stackStartCommand(files, repoPath),
        port: portOverride ?? DOCKERFILE_DEFAULT_PORT,
        healthPath: DEFAULT_HEALTH_PATH,
      },
    };
  }

  // Mode 2 — Python: entrypoint file or dependency manifest present.
  const pyTarget = findPythonTarget(files);
  if (pyTarget) {
    const port = portOverride ?? PYTHON_DEFAULT_PORT;
    return {
      config: {
        strategy: 'PYTHON',
        recipe: {
          baseImage: 'python:3.11-slim',
          installSteps: pyTarget.requirementsPath
            ? [`pip install --no-cache-dir -r ${pyTarget.requirementsPath}`]
            : [],
        },
        command: [],
        port,
        healthPath: DEFAULT_HEALTH_PATH,
      },
      generatedDockerfile: pythonDockerfile(pyTarget, port),
    };
  }

  // Mode 2 — Node: package.json with a start script.
  const nodeTarget = await findNodeTarget(files, repoPath);
  if (nodeTarget) {
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
      generatedDockerfile: nodeDockerfile(nodeTarget, port),
    };
  }

  throw new UnsupportedRuntimeError(files.slice(0, 4));
}

export function strategyLabel(strategy: RuntimeStrategy): string {
  return strategy === 'DOCKERFILE' ? 'Mode 1 (repo Dockerfile)' : 'Mode 2 (generated)';
}

// -- internals ---------------------------------------------------------------

async function listAllFiles(repoPath: string, maxDepth = 3): Promise<readonly string[]> {
  const result: string[] = [];
  const ignoreDirs = new Set(['.git', 'node_modules', 'dist', 'build', '__pycache__', '.venv', 'venv', '.next', '.output']);

  async function walk(currentDir: string, depth: number) {
    if (depth > maxDepth) return;
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(repoPath, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) {
          await walk(fullPath, depth + 1);
        }
      } else if (entry.isFile()) {
        result.push(relPath);
      }
    }
  }

  await walk(repoPath, 1);
  return result.sort();
}

function findDockerfile(files: readonly string[]): string | null {
  if (files.includes('Dockerfile')) return 'Dockerfile';
  return files.find((name) => /(^|\/)dockerfile(?:\..+)?$/i.test(name)) ?? null;
}

/** The repository declares its own `CMD` (any stage) → the image CMD governs. */
function hasDockerfileCmd(raw: string): boolean {
  return /^[ \t]*CMD\b/m.test(raw);
}

function findPythonTarget(files: readonly string[]): PythonTarget | null {
  let entrypoint: string | undefined;

  // 1. Root entrypoint
  for (const name of PYTHON_ENTRYPOINTS) {
    if (files.includes(name)) {
      entrypoint = name;
      break;
    }
  }

  // 2. Nested entrypoint
  if (!entrypoint) {
    for (const name of PYTHON_ENTRYPOINTS) {
      const match = files.find((f) => f.endsWith(`/${name}`));
      if (match) {
        entrypoint = match;
        break;
      }
    }
  }

  const requirementsPath = files.find(
    (f) => f === 'requirements.txt' || f.endsWith('/requirements.txt')
  );

  const pyprojectPath = files.find(
    (f) => f === 'pyproject.toml' || f.endsWith('/pyproject.toml')
  );

  const pipfilePath = files.find(
    (f) => f === 'Pipfile' || f.endsWith('/Pipfile')
  );

  if (!entrypoint && (requirementsPath || pyprojectPath || pipfilePath)) {
    const manifestPath = requirementsPath || pyprojectPath || pipfilePath;
    entrypoint = manifestPath
      ? path.posix.join(path.posix.dirname(manifestPath), 'app.py')
      : 'app.py';
  }

  if (!entrypoint) return null;

  return {
    entrypoint,
    requirementsPath,
  };
}

async function findNodeTarget(
  files: readonly string[],
  repoPath: string
): Promise<NodeTarget | null> {
  const packageJsons = files.filter(
    (f) => f === 'package.json' || f.endsWith('/package.json')
  );

  packageJsons.sort((a, b) => {
    const aIsRoot = a === 'package.json' ? 0 : 1;
    const bIsRoot = b === 'package.json' ? 0 : 1;
    return aIsRoot - bIsRoot;
  });

  for (const pkgPath of packageJsons) {
    const manifest = await fs
      .readFile(path.join(repoPath, pkgPath), 'utf8')
      .catch(() => null);
    if (!manifest) continue;
    try {
      const parsed = JSON.parse(manifest) as { scripts?: Record<string, string> };
      if (typeof parsed.scripts?.start === 'string') {
        return {
          packageJsonPath: pkgPath,
          startScript: parsed.scripts.start,
        };
      }
    } catch {
      /* ignore invalid JSON */
    }
  }

  return null;
}

function pythonEntrypointFrom(files: readonly string[]): string | undefined {
  const target = findPythonTarget(files);
  return target?.entrypoint;
}

async function stackStartCommand(
  files: readonly string[],
  repoPath: string
): Promise<readonly string[]> {
  const pythonTarget = findPythonTarget(files);
  if (pythonTarget) return ['python', pythonTarget.entrypoint];

  const nodeTarget = await findNodeTarget(files, repoPath);
  if (nodeTarget) return ['npm', 'start'];

  return [];
}