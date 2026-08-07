import type { TechnologySignal } from '../signal';

/**
 * Package-manager detection. Lockfiles are the strongest evidence; the
 * presence of a bare manifest (e.g. package.json alone) does not claim a
 * manager, because npm/yarn/pnpm all consume it.
 */
export const PACKAGE_MANAGER_SIGNALS: readonly TechnologySignal[] = [
  { name: 'npm', category: 'package-manager', confidence: 1.0, paths: ['package-lock.json'] },
  { name: 'pnpm', category: 'package-manager', confidence: 1.0, paths: ['pnpm-lock.yaml'] },
  { name: 'yarn', category: 'package-manager', confidence: 1.0, paths: ['yarn.lock'] },
  { name: 'pip', category: 'package-manager', confidence: 0.95, paths: ['requirements.txt', 'setup.py', 'Pipfile'] },
  {
    name: 'poetry',
    category: 'package-manager',
    confidence: 1.0,
    manifestContains: [{ path: 'pyproject.toml', needle: '[tool.poetry]' }],
  },
  { name: 'uv', category: 'package-manager', confidence: 0.95, paths: ['uv.lock', 'uv.toml'] },
  { name: 'conda', category: 'package-manager', confidence: 0.9, paths: ['environment.yml', 'environment.yaml'] },
  { name: 'Maven', category: 'package-manager', confidence: 1.0, paths: ['pom.xml'] },
  { name: 'Gradle', category: 'package-manager', confidence: 0.95, paths: ['build.gradle', 'settings.gradle', 'build.gradle.kts'] },
  { name: 'Cargo', category: 'package-manager', confidence: 1.0, paths: ['Cargo.toml'] },
  { name: 'Go Modules', category: 'package-manager', confidence: 1.0, paths: ['go.mod'] },
  { name: 'Pub', category: 'package-manager', confidence: 1.0, paths: ['pubspec.yaml'] },
  { name: 'Composer', category: 'package-manager', confidence: 1.0, paths: ['composer.json'] },
  { name: 'Bundler', category: 'package-manager', confidence: 0.95, paths: ['Gemfile', 'Gemfile.lock'] },
];