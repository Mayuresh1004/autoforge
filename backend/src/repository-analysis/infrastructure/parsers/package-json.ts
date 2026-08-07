import type { RawDependency, RawManifest } from './types';

const SCOPES = [
  ['dependencies', 'runtime'],
  ['devDependencies', 'development'],
  ['peerDependencies', 'peer'],
  ['optionalDependencies', 'optional'],
] as const;

function coerceVersion(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Parses a Node.js `package.json` (dependencies + engines).
 */
export function parsePackageJson(raw: string): RawManifest {
  const json = JSON.parse(raw) as Record<string, unknown>;
  const dependencies: RawDependency[] = [];

  for (const [group, scope] of SCOPES) {
    const entries = json[group];
    if (typeof entries !== 'object' || entries === null) continue;
    for (const [name, version] of Object.entries(entries)) {
      dependencies.push({ name, version: coerceVersion(version), scope });
    }
  }

  const engines = (json.engines ?? {}) as Record<string, unknown>;
  return {
    runtimes: {
      node: typeof engines.node === 'string' ? engines.node : null,
      npm: typeof engines.npm === 'string' ? engines.npm : null,
    },
    dependencies,
  };
}