/**
 * Benchmark corpus (research artifact): typed definitions + structural
 * validation for `benchmarks/corpus.json` (repo root). Kept as a plain
 * TS module (no ajv dependency) so the loader, matcher and collector share
 * one source of truth and stay testable in CI.
 */

export type RuntimeStrategy = 'repo-dockerfile' | 'generated-python' | 'generated-node';
export type FindingScope = 'sniper' | 'static' | 'future';

export interface SiblingContainerSpec {
  readonly name: string;
  readonly image: string;
  readonly env?: readonly string[];
}

export interface RuntimeSpec {
  readonly strategy: RuntimeStrategy;
  readonly port: number;
  readonly healthPath: string;
  readonly startCommand?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly siblingContainers?: readonly SiblingContainerSpec[];
}

export interface RouteSpec {
  readonly path: string;
  readonly method: string;
  readonly parameter?: string;
}

export interface FindingSpec {
  readonly id: string;
  readonly cweId: string;
  readonly vulnerabilityType?: string;
  readonly title: string;
  readonly severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  readonly scope: FindingScope;
  readonly filePath?: string;
  readonly routes?: readonly RouteSpec[];
  readonly notes?: string;
}

export interface CorpusApp {
  readonly id: string;
  readonly name: string;
  readonly repoUrl: string;
  readonly ref?: string;
  readonly runtime: RuntimeSpec;
  readonly expectedSurface?: readonly string[];
  readonly groundTruth: readonly FindingSpec[];
}

export interface BenchmarkCorpus {
  readonly version: number;
  readonly apps: readonly CorpusApp[];
}

export class CorpusValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`corpus.${path}: ${message}`);
    this.name = 'CorpusValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new CorpusValidationError(path, message);
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'expected a string');
  return value;
}

function int(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(path, 'expected an integer');
  return value;
}

function parseRoute(value: unknown, path: string): RouteSpec {
  if (!isRecord(value)) fail(path, 'expected an object');
  return {
    path: str(value.path, `${path}.path`),
    method: str(value.method, `${path}.method`),
    ...(typeof value.parameter === 'string' ? { parameter: value.parameter } : {}),
  };
}

function parseFinding(value: unknown, path: string): FindingSpec {
  if (!isRecord(value)) fail(path, 'expected an object');
  const scope = str(value.scope, `${path}.scope`);
  if (!['sniper', 'static', 'future'].includes(scope)) {
    fail(`${path}.scope`, `unknown scope "${scope}" (sniper|static|future)`);
  }
  const cweId = str(value.cweId, `${path}.cweId`);
  if (!/^CWE-[0-9]+$/.test(cweId)) fail(`${path}.cweId`, `invalid CWE id "${cweId}"`);
  const severity = typeof value.severity === 'string' ? value.severity : undefined;
  if (severity && !['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(severity)) {
    fail(`${path}.severity`, `unknown severity "${severity}"`);
  }
  const routes = Array.isArray(value.routes)
    ? value.routes.map((r, i) => parseRoute(r, `${path}.routes[${i}]`))
    : undefined;
  if (routes && routes.length === 0) fail(`${path}.routes`, 'must be a non-empty array when present');
  return {
    id: str(value.id, `${path}.id`),
    cweId,
    ...(typeof value.vulnerabilityType === 'string' ? { vulnerabilityType: value.vulnerabilityType } : {}),
    title: str(value.title, `${path}.title`),
    ...(severity ? { severity: severity as FindingSpec['severity'] } : {}),
    scope: scope as FindingScope,
    ...(typeof value.filePath === 'string' ? { filePath: value.filePath } : {}),
    ...(routes ? { routes } : {}),
    ...(typeof value.notes === 'string' ? { notes: value.notes } : {}),
  };
}

function parseRuntime(value: unknown, path: string): RuntimeSpec {
  if (!isRecord(value)) fail(path, 'expected an object');
  const strategy = str(value.strategy, `${path}.strategy`);
  if (!['repo-dockerfile', 'generated-python', 'generated-node'].includes(strategy)) {
    fail(`${path}.strategy`, `unknown strategy "${strategy}"`);
  }
  const env =
    isRecord(value.env) && Object.keys(value.env).length > 0
      ? Object.fromEntries(
          Object.entries(value.env).map(([k, v]) => [k, str(v, `${path}.env.${k}`)])
        )
      : undefined;
  const siblings = Array.isArray(value.siblingContainers)
    ? value.siblingContainers.map((s, i) => {
        if (!isRecord(s)) fail(`${path}.siblingContainers[${i}]`, 'expected an object');
        return {
          name: str(s.name, `${path}.siblingContainers[${i}].name`),
          image: str(s.image, `${path}.siblingContainers[${i}].image`),
          ...(Array.isArray(s.env)
            ? { env: s.env.map((e, j) => str(e, `${path}.siblingContainers[${i}].env[${j}]`)) }
            : {}),
        };
      })
    : undefined;
  return {
    strategy: strategy as RuntimeStrategy,
    port: int(value.port, `${path}.port`),
    healthPath: str(value.healthPath ?? '/', `${path}.healthPath`),
    ...(Array.isArray(value.startCommand) && value.startCommand.length > 0
      ? { startCommand: value.startCommand.map((c, i) => str(c, `${path}.startCommand[${i}]`)) }
      : {}),
    ...(env ? { env } : {}),
    ...(siblings ? { siblingContainers: siblings } : {}),
  };
}

function parseApp(value: unknown, path: string): CorpusApp {
  if (!isRecord(value)) fail(path, 'expected an object');
  const id = str(value.id, `${path}.id`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(`${path}.id`, `invalid app id "${id}"`);
  const groundTruth = Array.isArray(value.groundTruth)
    ? value.groundTruth.map((f, i) => parseFinding(f, `${path}.groundTruth[${i}]`))
    : [];
  if (groundTruth.length === 0) fail(`${path}.groundTruth`, 'must be a non-empty array');
  const expectedSurface = Array.isArray(value.expectedSurface)
    ? value.expectedSurface.map((s, i) => str(s, `${path}.expectedSurface[${i}]`))
    : undefined;
  return {
    id,
    name: str(value.name, `${path}.name`),
    repoUrl: str(value.repoUrl, `${path}.repoUrl`),
    ...(typeof value.ref === 'string' ? { ref: value.ref } : {}),
    runtime: parseRuntime(value.runtime, `${path}.runtime`),
    ...(expectedSurface ? { expectedSurface } : {}),
    groundTruth,
  };
}

/** Validate + normalize a parsed corpus JSON document. Throws on any bad shape. */
export function parseCorpus(raw: unknown): BenchmarkCorpus {
  if (!isRecord(raw)) throw new CorpusValidationError('', 'corpus must be a JSON object');
  if (raw.version !== 1) fail('version', 'expected version 1');
  const apps = Array.isArray(raw.apps) ? raw.apps.map((a, i) => parseApp(a, `apps[${i}]`)) : [];
  if (apps.length === 0) fail('apps', 'must be a non-empty array');
  const ids = new Set<string>();
  for (const app of apps) {
    if (ids.has(app.id)) fail('apps', `duplicate app id "${app.id}"`);
    ids.add(app.id);
  }
  return { version: 1, apps };
}

/** Join key: normalize a repo URL (scheme+host+path, no .git/trailing slash). */
export function normalizeRepoUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .toLowerCase();
}

/** Find the corpus app for a repository URL (or id/name fallback). */
export function findApp(corpus: BenchmarkCorpus, repoUrl?: string | null, scanName?: string | null): CorpusApp | null {
  if (repoUrl) {
    const needle = normalizeRepoUrl(repoUrl);
    const byUrl = corpus.apps.find((a) => normalizeRepoUrl(a.repoUrl) === needle);
    if (byUrl) return byUrl;
  }
  if (scanName) {
    const lower = scanName.toLowerCase();
    const byName = corpus.apps.find((a) => lower.includes(a.id) || lower.includes(a.name.toLowerCase()));
    if (byName) return byName;
  }
  return null;
}
