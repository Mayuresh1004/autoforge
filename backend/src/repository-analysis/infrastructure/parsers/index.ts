import type { ManifestParser } from './types';
import { parsePackageJson } from './package-json';
import { parseRequirementsTxt } from './requirements-txt';
import { parsePyprojectToml } from './pyproject-toml';
import { parseCargoToml } from './cargo-toml';
import { parsePomXml } from './pom-xml';
import { parseBuildGradle } from './build-gradle';
import { parseGoMod } from './go-mod';
import { parseComposerJson } from './composer-json';
import { parsePubspec } from './pubspec-yaml';
import { parseGemfileLock } from './gemfile-lock';

export interface ManifestDefinition {
  readonly ecosystem: string;
  /** Relative path of the manifest at the repository root. */
  readonly path: string;
  readonly parse: ManifestParser;
}

/**
 * The default set of supported dependency manifests. Adding a new ecosystem
 * is a one-line registry entry.
 */
export const MANIFEST_DEFINITIONS: readonly ManifestDefinition[] = [
  { ecosystem: 'npm', path: 'package.json', parse: parsePackageJson },
  { ecosystem: 'requirements.txt', path: 'requirements.txt', parse: parseRequirementsTxt },
  { ecosystem: 'pyproject.toml', path: 'pyproject.toml', parse: parsePyprojectToml },
  { ecosystem: 'cargo', path: 'Cargo.toml', parse: parseCargoToml },
  { ecosystem: 'maven', path: 'pom.xml', parse: parsePomXml },
  { ecosystem: 'gradle', path: 'build.gradle', parse: parseBuildGradle },
  { ecosystem: 'go.mod', path: 'go.mod', parse: parseGoMod },
  { ecosystem: 'composer', path: 'composer.json', parse: parseComposerJson },
  { ecosystem: 'pubspec', path: 'pubspec.yaml', parse: parsePubspec },
  { ecosystem: 'bundler', path: 'Gemfile.lock', parse: parseGemfileLock },
];