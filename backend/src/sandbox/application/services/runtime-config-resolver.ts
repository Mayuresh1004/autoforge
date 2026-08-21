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

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export interface NodeTarget {
  readonly packageJsonPath: string;
  readonly scriptName: string;
  readonly startScript: string;
  readonly packageManager: PackageManager;
  readonly baseImage: string;
  readonly requiresBuild: boolean;
  readonly buildScript?: string;
  readonly detectedPort: number;
}

interface PackageManifest {
  readonly name?: string;
  readonly main?: string;
  readonly packageManager?: string;
  readonly engines?: { readonly node?: string };
  readonly scripts?: Record<string, string>;
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
  const lines: string[] = [
    `FROM ${target.baseImage}`,
    'WORKDIR /app',
    `ENV PORT=${port}`,
    'ENV HOST=0.0.0.0',
    'ENV NEXT_PUBLIC_APPWRITE_HOST_URL=http://localhost:8000',
    'ENV NEXT_PUBLIC_APPWRITE_PROJECT_ID=amass_runtime_dev_project',
    'ENV APPWRITE_API_KEY=amass_runtime_dev_key',
    'ENV DATABASE_ID=amass_runtime_dev_db',
    'ENV NEXT_PUBLIC_API_URL=http://localhost:3000',
    'ENV SUPABASE_URL=http://localhost:54321',
    'ENV SUPABASE_ANON_KEY=amass_runtime_dev_key',
    'COPY . .',
  ];

  if (target.packageManager === 'pnpm') {
    lines.push('RUN corepack enable || npm install -g pnpm');
  }

  let installCmd: string;
  let buildCmd: string;

  switch (target.packageManager) {
    case 'pnpm':
      installCmd = 'pnpm install --no-frozen-lockfile';
      buildCmd = 'pnpm run build';
      break;
    case 'yarn':
      installCmd = 'yarn install';
      buildCmd = 'yarn run build';
      break;
    case 'npm':
    default:
      installCmd = 'npm install --no-audit --no-fund';
      buildCmd = 'npm run build';
      break;
  }

  if (dir === '.') {
    lines.push(`RUN ${installCmd}`);
    if (target.requiresBuild) {
      lines.push(`RUN ${buildCmd}`);
    }
    lines.push('ENV NODE_ENV=production');
    lines.push(`EXPOSE ${port}`);
    if (target.scriptName === 'start') {
      lines.push(`CMD ["${target.packageManager}", "start"]`);
    } else {
      lines.push(`CMD ["${target.packageManager}", "run", "${target.scriptName}"]`);
    }
  } else {
    lines.push(`RUN cd ${dir} && ${installCmd}`);
    if (target.requiresBuild) {
      lines.push(`RUN cd ${dir} && ${buildCmd}`);
    }
    lines.push('ENV NODE_ENV=production');
    lines.push(`EXPOSE ${port}`);
    if (target.packageManager === 'npm') {
      lines.push(`CMD ["npm", "start", "--prefix", "${dir}"]`);
    } else {
      lines.push(`CMD ["sh", "-c", "cd ${dir} && ${target.packageManager} run ${target.scriptName}"]`);
    }
  }

  return lines.join('\n');
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
    const exposedPort = parseExposePort(raw);
    return {
      config: {
        strategy: 'DOCKERFILE',
        dockerfile: { path: dockerfile },
        command: hasDockerfileCmd(raw) ? [] : await stackStartCommand(files, repoPath),
        port: portOverride ?? exposedPort ?? DOCKERFILE_DEFAULT_PORT,
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

  // Mode 2 — Node: package.json with a start/serve/dev script or manifest.
  const nodeTarget = await findNodeTarget(files, repoPath);
  if (nodeTarget) {
    const port = portOverride ?? nodeTarget.detectedPort;
    return {
      config: {
        strategy: 'NODE',
        recipe: {
          baseImage: nodeTarget.baseImage,
          installSteps: [nodeInstallStep(nodeTarget.packageManager)],
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

export function parseExposePort(rawDockerfile: string): number | null {
  const matches = [...rawDockerfile.matchAll(/^[ \t]*EXPOSE[ \t]+([^\r\n]+)/gim)];
  if (matches.length === 0) return null;
  const lastLine = matches[matches.length - 1][1];
  const portMatch = /\b(\d{2,5})\b/.exec(lastLine);
  if (portMatch && portMatch[1]) {
    const port = parseInt(portMatch[1], 10);
    if (port > 0 && port < 65536) return port;
  }
  return null;
}

function nodeInstallStep(pkgManager: PackageManager): string {
  switch (pkgManager) {
    case 'pnpm':
      return 'pnpm install --no-frozen-lockfile';
    case 'yarn':
      return 'yarn install';
    case 'npm':
    default:
      return 'npm install --no-audit --no-fund';
  }
}

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

export function detectNodeEngine(manifest: PackageManifest): string {
  const engineStr = manifest.engines?.node;
  if (!engineStr) return 'node:20-alpine';

  if (/\b(22|23|24|25|26)\b/.test(engineStr)) {
    return 'node:22-alpine';
  }
  if (/\b(18)\b/.test(engineStr) && !/\b(20|22)\b/.test(engineStr)) {
    return 'node:18-alpine';
  }
  if (/\b(16)\b/.test(engineStr) && !/\b(18|20|22)\b/.test(engineStr)) {
    return 'node:16-alpine';
  }

  return 'node:20-alpine';
}

export function detectPackageManager(
  manifest: PackageManifest,
  files: readonly string[]
): PackageManager {
  if (typeof manifest.packageManager === 'string') {
    const pm = manifest.packageManager.toLowerCase();
    if (pm.startsWith('pnpm')) return 'pnpm';
    if (pm.startsWith('yarn')) return 'yarn';
    if (pm.startsWith('npm')) return 'npm';
  }

  if (files.some((f) => f === 'pnpm-lock.yaml' || f.endsWith('/pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (files.some((f) => f === 'yarn.lock' || f.endsWith('/yarn.lock'))) {
    return 'yarn';
  }
  if (files.some((f) => f === 'package-lock.json' || f.endsWith('/package-lock.json'))) {
    return 'npm';
  }

  return 'npm';
}

function detectPortFromScript(script?: string): number {
  if (!script) return NODE_DEFAULT_PORT;
  const match = /(?:--port|-p|PORT=)\s*(\d{4,5})/i.exec(script);
  if (match && match[1]) {
    const parsed = parseInt(match[1], 10);
    if (parsed > 0 && parsed < 65536) return parsed;
  }
  return NODE_DEFAULT_PORT;
}

export async function findNodeTarget(
  files: readonly string[],
  repoPath: string
): Promise<NodeTarget | null> {
  const packageJsons = files.filter(
    (f) => f === 'package.json' || f.endsWith('/package.json')
  );

  if (packageJsons.length === 0) return null;

  packageJsons.sort((a, b) => {
    const aIsRoot = a === 'package.json' ? 0 : 1;
    const bIsRoot = b === 'package.json' ? 0 : 1;
    if (aIsRoot !== bIsRoot) return aIsRoot - bIsRoot;

    const aIsBackend = /(backend|server|api|app)\//i.test(a) ? 0 : 1;
    const bIsBackend = /(backend|server|api|app)\//i.test(b) ? 0 : 1;
    return aIsBackend - bIsBackend;
  });

  for (const pkgPath of packageJsons) {
    const manifestStr = await fs
      .readFile(path.join(repoPath, pkgPath), 'utf8')
      .catch(() => null);
    if (!manifestStr) continue;
    try {
      const parsed = JSON.parse(manifestStr) as PackageManifest;
      const scripts = parsed.scripts ?? {};

      let scriptName: string | undefined;
      if (typeof scripts.start === 'string') scriptName = 'start';
      else if (typeof scripts.serve === 'string') scriptName = 'serve';
      else if (typeof scripts.dev === 'string') scriptName = 'dev';
      else if (typeof scripts.preview === 'string') scriptName = 'preview';

      if (!scriptName && !parsed.main && Object.keys(scripts).length === 0) {
        continue;
      }

      const selectedScript = scriptName ? scripts[scriptName] ?? 'node index.js' : 'node index.js';
      const actualScriptName = scriptName ?? 'start';

      const packageManager = detectPackageManager(parsed, files);
      const baseImage = detectNodeEngine(parsed);

      const hasBuildScript = typeof scripts.build === 'string';
      const startPointsToBuildDir = /\b(build|dist|\.next|out)\//i.test(selectedScript || parsed.main || '');
      const hasTsConfig = files.some((f) => f === 'tsconfig.json' || f.endsWith('/tsconfig.json'));
      const isFrameworkBuild = /next|nuxt|vite|tsc|nest|ng\b/i.test(scripts.build || '');
      const hasNextConfig = files.some((f) => /next\.config\.(ts|js|mjs|cjs)$/i.test(f));

      const requiresBuild = hasBuildScript && (startPointsToBuildDir || hasTsConfig || isFrameworkBuild || hasNextConfig);

      const detectedPort = detectPortFromScript(selectedScript);

      return {
        packageJsonPath: pkgPath,
        scriptName: actualScriptName,
        startScript: selectedScript,
        packageManager,
        baseImage,
        requiresBuild,
        buildScript: scripts.build,
        detectedPort,
      };
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
  if (nodeTarget) return [nodeTarget.packageManager, 'start'];

  return [];
}