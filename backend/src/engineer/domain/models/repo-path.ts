/**
 * Repository-path safety helpers shared by the source reader and the patch
 * validator. Repository paths are ALWAYS relative to the repository root:
 * - no absolute paths (leading '/'), no drive letters, no `..` segments
 * - forward slashes only, no NUL/control characters
 * - bounded segment count (depth) and total length
 *
 * The same rules are enforced when accepting the LLM's diff so a generated
 * patch can never escape the repository or jump into unrelated directories.
 */

/** Common code file extensions Engineer may read/target. */
const CODE_EXTENSIONS = new Set([
  'py', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'java', 'go', 'rb', 'php',
  'rs', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'kt', 'swift', 'scala', 'sql',
  'html', 'htm', 'css', 'scss', 'less', 'xml', 'yml', 'yaml', 'json', 'toml',
  'ini', 'conf', 'sh', 'bash', 'zsh', 'ps1', 'vue', 'svelte', 'tf', 'sol',
  'gradle', 'properties', 'proto', 'graphql', 'gql',
]);

/** Lock / vendor / generated files that are never valid remediation targets. */
const DENIED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'woff', 'woff2',
  'ttf', 'otf', 'eot', 'pdf', 'zip', 'gz', 'tar', '7z', 'rar', 'exe', 'dll',
  'so', 'dylib', 'class', 'jar', 'war', 'map', 'lock', 'min.js', 'min.css',
]);

const DENIED_FILE_NAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json',
  'composer.lock', 'Gemfile.lock', 'Cargo.lock', 'poetry.lock', 'requirements.lock',
  'Pipfile.lock', 'go.sum',
]);

const MAX_REPO_PATH_DEPTH = 16;
const MAX_REPO_PATH_CHARS = 512;
const RELATIVE_PATH_PATTERN = /^[A-Za-z0-9_.\-\/]+$/;

/** Normalize separators and trim; returns the safe relative form or '' when unsafe. */
export function normalizeRepoPath(raw: string): string {
  const cleaned = raw.replace(/\\/g, '/').trim().replace(/^\.\//, '');
  if (cleaned.length === 0 || cleaned.length > MAX_REPO_PATH_CHARS) return '';
  if (cleaned.startsWith('/') || /^[A-Za-z]:/.test(cleaned)) return '';
  if (!RELATIVE_PATH_PATTERN.test(cleaned)) return '';
  const segments = cleaned.split('/');
  if (segments.some((s) => s === '..' || s === '.' || s.length === 0)) return '';
  if (segments.length > MAX_REPO_PATH_DEPTH) return '';
  return cleaned;
}

const DENIED_DIRECTORIES = new Set([
  'dist', 'build', '.next', '.nuxt', '.output', 'target', 'coverage', '.cache', 'out', 'vendor',
]);

/** Acceptable to read/patch as source code (extension + lockfile + build artifact blacklist). */
export function isSupportedCodeFile(path: string): boolean {
  if (DENIED_FILE_NAMES.has(path)) return false;
  const segments = path.split('/');
  if (segments.some((s) => DENIED_DIRECTORIES.has(s.toLowerCase()))) return false;
  const lower = path.toLowerCase();
  if (DENIED_EXTENSIONS.has(lower.slice(lower.lastIndexOf('.') + 1))) return false;
  const dot = path.lastIndexOf('.');
  if (dot === -1) return true; // extension-less files (Dockerfile, Makefile…)
  return CODE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/** True when `candidate` is the same file as (or inside the same root as)
 *  `expected` — used to keep a patch from touching obviously unrelated files. */
export function isRelatedTo(candidate: string, expectedFile: string | null): boolean {
  if (!expectedFile) return false;
  const a = normalizeRepoPath(candidate);
  const b = normalizeRepoPath(expectedFile);
  return a !== '' && b !== '' && (a === b || a.startsWith(`${b.split('/')[0]}/`));
}

export function longestSafeRelativePath(raw: string): string {
  return normalizeRepoPath(raw);
}