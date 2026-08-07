import YAML from 'yaml';
import type { RawDependency, RawManifest } from './types';

type YamlObject = Record<string, unknown>;

/**
 * Parses a Dart/Flutter `pubspec.yaml` (dependencies, dev_dependencies,
 * and SDK constraint).
 */
export function parsePubspec(raw: string): RawManifest {
  let doc: YamlObject;
  try {
    doc = YAML.parse(raw) as YamlObject;
  } catch {
    return { runtimes: {}, dependencies: [] };
  }

  const dependencies: RawDependency[] = [];
  const groups: Array<[string, RawDependency['scope']]> = [
    ['dependencies', 'runtime'],
    ['dev_dependencies', 'development'],
  ];
  for (const [group, scope] of groups) {
    const entries = doc[group];
    if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) continue;
    for (const [name, value] of Object.entries(entries as YamlObject)) {
      const version =
        typeof value === 'string' ? value : typeof value === 'object' && value !== null
          ? (((value as YamlObject).version as unknown) as string | undefined) ?? null
          : null;
      dependencies.push({ name, version, scope });
    }
  }

  const environment = doc.environment as YamlObject | undefined;
  return {
    runtimes: { sdk: typeof environment?.sdk === 'string' ? environment.sdk : null },
    dependencies,
  };
}