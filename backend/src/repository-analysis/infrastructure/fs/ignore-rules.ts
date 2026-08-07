/**
 * A small, dependency-free gitignore-style matcher.
 *
 * Supports the commonly used rules:
 *   - comments (`#`) and blank lines
 *   - negation (`!pattern`)
 *   - directory-only patterns (`pattern/`)
 *   - root-anchored patterns (`/pattern`)
 *   - `*`, `?`, `**` globbing
 *
 * Execution order matches git: patterns are evaluated in order and the last
 * matching rule wins. If a directory is ignored its whole subtree is pruned
 * (the same behaviour git has for re-including files under an ignored dir).
 */

type RuleKind = 'name' | 'anchored' | 'glob';

interface CompiledRule {
  readonly kind: RuleKind;
  readonly source: string;
  readonly negated: boolean;
  readonly dirOnly: boolean;
  readonly pathScoped: boolean;
  readonly base?: string;
  readonly regex?: RegExp;
}

/**
 * Generated/vendor/secret directories and files that should never be walked
 * or read during analysis. Folder names use the `dir/` form so same-named
 * source files are never hidden. Kept conservative to avoid hiding real code.
 */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  'target/',
  'vendor/',
  '__pycache__/',
  '.next/',
  '.nuxt/',
  '.output/',
  '.venv/',
  'venv/',
  'coverage/',
  '.idea/',
  '.vscode/',
  '.gradle/',
  '.terraform/',
  '.serverless/',
  'storybook-static/',
  '.turbo/',
  '.cache/',
  '.pytest_cache/',
  '.mypy_cache/',
  '.ruff_cache/',
  'logs/',
  'tmp/',
  '.dart_tool/',
  'out/',
  // Secrets + generated files (file rules)
  '.env',
  '.DS_Store',
  '*.pyc',
  '*.class',
  '*.log',
];

function globToRegExp(glob: string, anchored: boolean): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 1;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  const full = anchored ? `^${out}$` : `(^|/)${out}$`;
  return new RegExp(full);
}

function compileRule(pattern: string): CompiledRule | null {
  let source = pattern.trim();
  if (source === '' || source.startsWith('#')) return null;
  // An escaped leading `\#` is a literal hash.
  if (source.startsWith('\\#')) source = source.slice(1).trim();

  let negated = false;
  if (source.startsWith('!')) {
    negated = true;
    source = source.slice(1).trim();
  }

  let dirOnly = false;
  if (source.endsWith('/')) {
    dirOnly = true;
    source = source.slice(0, -1);
  }

  let anchored = false;
  if (source.startsWith('/')) {
    anchored = true;
    source = source.slice(1);
  }

  const pathScoped = source.includes('/');
  if (source === '') return null;

  if (/[*?]/.test(source)) {
    return {
      kind: 'glob',
      source: pattern,
      negated,
      dirOnly,
      pathScoped: pathScoped || anchored,
      regex: globToRegExp(source, pathScoped || anchored),
    };
  }

  return {
    kind: anchored ? 'anchored' : 'name',
    source: pattern,
    negated,
    dirOnly,
    pathScoped,
    base: source,
  };
}

export class IgnoreRules {
  private readonly rules: CompiledRule[];

  constructor(userPatterns: readonly string[]) {
    this.rules = [...DEFAULT_IGNORE_PATTERNS, ...userPatterns]
      .map(compileRule)
      .filter((r): r is CompiledRule => r !== null);
  }

  /**
   * Builds rules from the built-in defaults merged with caller patterns.
   */
  static withDefaults(userPatterns: readonly string[] = []): IgnoreRules {
    return new IgnoreRules(userPatterns);
  }

  /**
   * Returns true when the given relative path should be skipped.
   *
   * @param relativePath path relative to the analyzed root, `/`-separated
   * @param isDirectory whether the path refers to a directory
   */
  isIgnored(relativePath: string, isDirectory: boolean): boolean {
    const segments = relativePath.split('/').filter((s) => s.length > 0);
    if (segments.length === 0) return false;

    let ignored = false;
    for (const rule of this.rules) {
      if (this.matches(rule, segments, isDirectory)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }

  private matches(rule: CompiledRule, segments: string[], isDirectory: boolean): boolean {
    if (rule.dirOnly && !isDirectory) return false;

    if (rule.kind === 'name') {
      return segments.includes(rule.base as string);
    }

    if (rule.kind === 'anchored') {
      return segments[0] === rule.base;
    }

    // glob
    const target = rule.pathScoped
      ? segments.join('/')
      : segments[segments.length - 1];
    return (rule.regex as RegExp).test(target);
  }
}