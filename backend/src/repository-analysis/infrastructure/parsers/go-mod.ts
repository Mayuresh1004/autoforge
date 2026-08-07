import type { RawDependency, RawManifest } from './types';

const REQUIRE_RE = /^require\s+(.+)$/;

/**
 * Parses a `go.mod`: module path, Go version, and the `require` block.
 */
export function parseGoMod(raw: string): RawManifest {
  const runtimes: Record<string, string | null> = {};
  const dependencies: RawDependency[] = [];

  let inRequireBlock = false;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('go ')) {
      runtimes.go = line.slice(3).trim() || null;
      continue;
    }
    if (line === 'require (') {
      inRequireBlock = true;
      continue;
    }
    if (line === ')') {
      inRequireBlock = false;
      continue;
    }
    if (inRequireBlock && line) {
      const [name, version] = line.split(/\s+/);
      if (name && version) {
        dependencies.push({ name, version, scope: 'runtime' });
      }
      continue;
    }
    if (!inRequireBlock) {
      const requireMatch = REQUIRE_RE.exec(line);
      if (requireMatch) {
        const [name, version] = requireMatch[1].trim().split(/\s+/);
        if (name && version) {
          dependencies.push({ name, version, scope: 'runtime' });
        }
      }
    }
  }

  return { runtimes, dependencies };
}