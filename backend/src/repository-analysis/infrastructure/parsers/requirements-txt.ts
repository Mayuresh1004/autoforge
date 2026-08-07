import { parsePep508 } from './parse-pep508';
import type { RawDependency, RawManifest } from './types';

/**
 * Parses a `requirements.txt` into runtime dependencies.
 */
export function parseRequirementsTxt(raw: string): RawManifest {
  const dependencies: RawDependency[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parsePep508(line);
    if (parsed) {
      dependencies.push({ name: parsed.name, version: parsed.version, scope: 'runtime' });
    }
  }
  return { runtimes: {}, dependencies };
}