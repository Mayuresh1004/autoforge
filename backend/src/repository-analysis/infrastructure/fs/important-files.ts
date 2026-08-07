import type { ImportantFile, ImportantFileCategory } from '../../domain/models/file-system';

interface ImportantFileRule {
  readonly name: string;
  readonly category: ImportantFileCategory;
}

/**
 * Files/directories that signal technology, tooling, or configuration, keyed
 * by exact file name. `.env` itself is intentionally *not* listed here
 * (it is ignored as a secret), but its safe template `.env.example` is.
 */
const BY_NAME: Record<string, ImportantFileRule> = {};

function register(name: string, category: ImportantFileCategory): void {
  BY_NAME[name] = { name, category };
}

// Manifests / dependency declarations
['package.json', 'requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'].forEach((f) =>
  register(f, 'manifest')
);
['pom.xml', 'build.gradle', 'settings.gradle', 'Cargo.toml', 'go.mod'].forEach((f) =>
  register(f, 'manifest')
);
['composer.json', 'pubspec.yaml', 'Gemfile', 'csproj'].forEach((f) =>
  register(f, 'manifest')
);

// Lockfiles
[
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'Cargo.lock',
  'go.sum',
  'Gemfile.lock',
  'composer.lock',
].forEach((f) => register(f, 'lockfile'));

// Containerization / orchestration
[
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  '.dockerignore',
  'Chart.yaml',
  'values.yaml',
  'kustomization.yaml',
  'helmfile.yaml',
].forEach((f) => register(f, 'container'));

// CI/CD
[
  '.gitlab-ci.yml',
  'azure-pipelines.yml',
  'bitbucket-pipelines.yml',
  'Jenkinsfile',
  '.travis.yml',
  '.appveyor.yml',
  'buildkite.yml',
].forEach((f) => register(f, 'ci'));

// Development configuration
[
  'tsconfig.json',
  '.env.example',
  '.nvmrc',
  '.node-version',
  '.python-version',
  '.ruby-version',
  'vite.config.ts',
  'vite.config.js',
  'webpack.config.js',
  'next.config.js',
  'next.config.mjs',
  'turbo.json',
  'nx.json',
  'jest.config.js',
  'jest.config.ts',
  'vitest.config.ts',
  'vitest.config.js',
  'vitest.config.mjs',
  '.babelrc',
  '.npmrc',
  '.pypirc',
  'firebase.json',
  'vercel.json',
  'netlify.toml',
  'serverless.yml',
  'supabase/config.toml',
].forEach((f) => register(f, 'config'));

// Documentation / licensing
['README.md', 'README', 'CONTRIBUTING.md', 'CHANGELOG.md', 'LICENSE', 'LICENSE.md'].forEach(
  (f) => register(f, 'docs')
);

/**
 * Rules matched against the leading path segments (directories) so we can
 * report project-level structure such as workflow or infra folders.
 */
const PREFIX_RULES: ReadonlyArray<{
  readonly prefix: string;
  readonly name: string;
  readonly category: ImportantFileCategory;
}> = [
  { prefix: '.github/workflows', name: '.github/workflows', category: 'ci' },
  { prefix: '.circleci', name: '.circleci', category: 'ci' },
  { prefix: '.devcontainer', name: '.devcontainer', category: 'container' },
  { prefix: 'k8s', name: 'k8s', category: 'container' },
  { prefix: 'terraform', name: 'terraform', category: 'infra' },
  { prefix: 'docs/', name: 'docs', category: 'docs' },
];

export interface ImportantFileRegistry {
  lookupByName(name: string): { name: string; category: ImportantFileCategory } | null;
  lookupByPrefix(relativePath: string): { name: string; category: ImportantFileCategory } | null;
}

/**
 * Catalog of recognizable "important files" used to surface key project
 * artifacts during the walk.
 */
export const importantFileRegistry: ImportantFileRegistry = {
  lookupByName(name: string) {
    return BY_NAME[name] ?? null;
  },

  lookupByPrefix(relativePath: string) {
    for (const rule of PREFIX_RULES) {
      if (relativePath === rule.prefix || relativePath.startsWith(`${rule.prefix}/`)) {
        return { name: rule.name, category: rule.category };
      }
    }
    return null;
  },
};