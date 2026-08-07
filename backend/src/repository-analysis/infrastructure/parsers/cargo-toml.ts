import TOML from '@iarna/toml';
import type { RawDependency, RawManifest } from './types';

type TomlObject = Record<string, unknown>;

function versionOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const v = (value as TomlObject).version;
    if (typeof v === 'string') return v;
    return null;
  }
  return null;
}

/**
 * Parses a Rust `Cargo.toml` (runtime + dev-dependencies).
 */
export function parseCargoToml(raw: string): RawManifest {
  let toml: TomlObject;
  try {
    toml = TOML.parse(raw) as TomlObject;
  } catch {
    return { runtimes: {}, dependencies: [] };
  }

  const dependencies: RawDependency[] = [];
  const configs: Array<[key: string, scope: RawDependency['scope']]> = [
    ['dependencies', 'runtime'],
    ['dev-dependencies', 'development'],
  ];

  for (const [key, scope] of configs) {
    const table = toml[key];
    if (typeof table !== 'object' || table === null || Array.isArray(table)) continue;
    for (const [name, value] of Object.entries(table)) {
      dependencies.push({ name, version: versionOf(value), scope });
    }
  }

  return { runtimes: {}, dependencies };
}