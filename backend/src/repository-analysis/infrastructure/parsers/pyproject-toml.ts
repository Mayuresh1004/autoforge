import TOML from '@iarna/toml';
import { parsePep508 } from './parse-pep508';
import type { RawDependency, RawManifest } from './types';

type TomlObject = Record<string, unknown>;

/**
 * Parses a Python `pyproject.toml`, covering `[project]` (PEP 621 / uv)
 * and legacy `[tool.poetry]` dependency tables.
 */
export function parsePyprojectToml(raw: string): RawManifest {
  let toml: TomlObject;
  try {
    toml = TOML.parse(raw) as TomlObject;
  } catch {
    return { runtimes: {}, dependencies: [] };
  }

  const dependencies: RawDependency[] = [];

  const project = toml.project as TomlObject | undefined;
  if (project && Array.isArray(project.dependencies)) {
    for (const spec of project.dependencies) {
      const parsed = typeof spec === 'string' ? parsePep508(spec) : null;
      if (parsed) {
        dependencies.push({ name: parsed.name, version: parsed.version, scope: 'runtime' });
      }
    }
    const optional = project['optional-dependencies'];
    if (optional && typeof optional === 'object' && !Array.isArray(optional)) {
      for (const group of Object.values(optional as TomlObject)) {
        if (!Array.isArray(group)) continue;
        for (const spec of group) {
          const parsed = typeof spec === 'string' ? parsePep508(spec) : null;
          if (parsed) {
            dependencies.push({ name: parsed.name, version: parsed.version, scope: 'optional' });
          }
        }
      }
    }
  }

  const tool = toml.tool as TomlObject | undefined;
  const poetry = tool?.poetry as TomlObject | undefined;
  const poetryDeps = poetry?.dependencies as TomlObject | undefined;
  if (poetryDeps && typeof poetryDeps === 'object' && !Array.isArray(poetryDeps)) {
    for (const [name, value] of Object.entries(poetryDeps)) {
      if (name === 'python') continue;
      const version =
        typeof value === 'string'
          ? (value as string)
          : (value as TomlObject | undefined)?.version
            ? String((value as TomlObject).version)
            : null;
      dependencies.push({ name, version, scope: 'runtime' });
    }
  }

  const requiresPython = project?.['requires-python'];
  return {
    runtimes: {
      python: typeof requiresPython === 'string' ? requiresPython : null,
    },
    dependencies,
  };
}