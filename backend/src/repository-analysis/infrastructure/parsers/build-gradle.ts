import type { RawDependency, RawManifest } from './types';

// `implementation 'group:artifact:version'` (and `api`/`compileOnly` variants)
const COORDINATES_RE = /(?:implementation|api|compileOnly|runtimeOnly|classpath)\s+['"]([A-Za-z0-9_.\-]+(?::[A-Za-z0-9_.\-]+)+):([^'"]+)['"]/g;
// `implementation group: 'group', name: 'artifact', version: '1.0'`
const GROUP_NAMED_RE =
  /(?:implementation|api|compileOnly|runtimeOnly|classpath)\s+group:\s*['"]([^'"]+)['"]\s*,\s*name:\s*['"]([^'"]+)['"]\s*,\s*version:\s*['"]([^'"]+)['"]/g;

/**
 * Best-effort parser for Gradle `build.gradle` dependency declarations.
 * The Groovy/Kotlin DSL is far too flexible to fully parse without a
 * compiler, so only the common coordinate forms are captured.
 */
export function parseBuildGradle(raw: string): RawManifest {
  const dependencies: RawDependency[] = [];

  for (const match of raw.matchAll(COORDINATES_RE)) {
    dependencies.push({
      name: match[1],
      version: match[2] || null,
      scope: 'runtime',
    });
  }

  for (const match of raw.matchAll(GROUP_NAMED_RE)) {
    dependencies.push({
      name: `${match[1]}:${match[2]}`,
      version: match[3],
      scope: 'runtime',
    });
  }

  return { runtimes: {}, dependencies };
}