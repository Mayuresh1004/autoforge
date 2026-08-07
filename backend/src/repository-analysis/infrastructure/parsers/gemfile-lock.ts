import type { RawDependency, RawManifest } from './types';

const SPEC_RE = /^ {4}(\S+?) \(([^)]*)\)/; // exactly 4-space indented spec
const RUBY_VERSION_RE = /ruby (\d[\w.]*)/;

/**
 * Parses a `Gemfile.lock` into resolved runtime dependencies and the Ruby
 * version (declared in the `RUBY VERSION` section).
 */
export function parseGemfileLock(raw: string): RawManifest {
  const dependencies: RawDependency[] = [];
  const runtimes: Record<string, string | null> = { ruby: null };

  for (const line of raw.split(/\r?\n/)) {
    const specMatch = SPEC_RE.exec(line);
    if (specMatch) {
      dependencies.push({ name: specMatch[1], version: specMatch[2] || null, scope: 'runtime' });
      continue;
    }
    // Pull the ruby version only from the `RUBY VERSION` block.
    if (line.trim().toUpperCase().startsWith('RUBY VERSION')) {
      runtimes.ruby = RUBY_VERSION_RE.exec(line.toLowerCase())?.[1] ?? null;
    }
  }

  return { runtimes, dependencies };
}