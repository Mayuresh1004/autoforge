import type { RawDependency, RawManifest } from './types';

/**
 * Parses a PHP `composer.json` (require / require-dev).
 */
export function parseComposerJson(raw: string): RawManifest {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { runtimes: {}, dependencies: [] };
  }

  const dependencies: RawDependency[] = [];
  const groups: Array<[string, RawDependency['scope']]> = [
    ['require', 'runtime'],
    ['require-dev', 'development'],
  ];
  for (const [group, scope] of groups) {
    const entries = json[group];
    if (typeof entries !== 'object' || entries === null) continue;
    for (const [name, version] of Object.entries(entries)) {
      dependencies.push({ name, version: typeof version === 'string' ? version : null, scope });
    }
  }

  const require = (json.require ?? {}) as Record<string, unknown>;
  return {
    runtimes: { php: typeof require.php === 'string' ? require.php : null },
    dependencies,
  };
}