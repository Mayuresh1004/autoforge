import type { TechnologySignal } from '../signal';

/**
 * Runtime / ecosystem detection from manifests and config files.
 */
export const RUNTIME_SIGNALS: readonly TechnologySignal[] = [
  {
    name: 'Node.js',
    category: 'runtime',
    confidence: 1.0,
    paths: ['package.json'],
    engines: ['node'],
  },
  {
    name: 'Python',
    category: 'runtime',
    confidence: 1.0,
    paths: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'],
  },
  { name: 'Go', category: 'runtime', confidence: 1.0, paths: ['go.mod'] },
  { name: 'Rust', category: 'runtime', confidence: 1.0, paths: ['Cargo.toml'] },
  { name: 'JVM', category: 'runtime', confidence: 0.9, paths: ['pom.xml', 'build.gradle', 'settings.gradle'] },
  { name: '.NET', category: 'runtime', confidence: 0.9, globs: ['**/*.csproj', '**/*.sln'] },
  { name: 'Ruby', category: 'runtime', confidence: 1.0, paths: ['Gemfile'] },
  { name: 'PHP', category: 'runtime', confidence: 1.0, paths: ['composer.json'] },
  { name: 'Dart', category: 'runtime', confidence: 1.0, paths: ['pubspec.yaml'] },
  { name: 'Bun', category: 'runtime', confidence: 0.9, paths: ['bun.lockb', 'bun.lock', 'bunfig.toml'] },
  { name: 'Deno', category: 'runtime', confidence: 0.9, paths: ['deno.json', 'deno.jsonc', 'deno.lock'] },
];