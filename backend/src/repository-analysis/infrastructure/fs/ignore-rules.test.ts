import { describe, it, expect } from 'vitest';
import { IgnoreRules, DEFAULT_IGNORE_PATTERNS } from './ignore-rules';

function rules(patterns: string[]): IgnoreRules {
  return new IgnoreRules(patterns);
}

describe('IgnoreRules', () => {
  it('ignores built-in generated folders anywhere in the tree', () => {
    const r = rules([]);
    expect(r.isIgnored('node_modules', true)).toBe(true);
    expect(r.isIgnored('src/node_modules', true)).toBe(true);
    expect(r.isIgnored('.git', true)).toBe(true);
    expect(r.isIgnored('dist', true)).toBe(true);
    expect(r.isIgnored('src/../dist', true)).toBe(true);
  });

  it('does not ignore ordinary source paths', () => {
    const r = rules([]);
    expect(r.isIgnored('src/index.ts', false)).toBe(false);
    expect(r.isIgnored('src', true)).toBe(false);
    expect(r.isIgnored('package.json', false)).toBe(false);
  });

  it('matches a plain name at any depth', () => {
    const r = rules(['coverage']);
    expect(r.isIgnored('coverage', true)).toBe(true);
    expect(r.isIgnored('packages/a/coverage', true)).toBe(true);
  });

  it('matches root-anchored patterns only at the root', () => {
    const r = rules(['/generated']);
    expect(r.isIgnored('generated', true)).toBe(true);
    expect(r.isIgnored('src/generated', true)).toBe(false);
  });

  it('directory-only patterns ignore directories but not same-named files', () => {
    const r = rules(['build/']);
    expect(r.isIgnored('build', true)).toBe(true);
    expect(r.isIgnored('src/build', true)).toBe(true);
    expect(r.isIgnored('build', false)).toBe(false);
  });

  it('supports glob patterns on basenames and paths', () => {
    const r = rules(['*.log', 'src/*.tmp']);
    expect(r.isIgnored('app.log', false)).toBe(true);
    expect(r.isIgnored('deep/nested/x.log', false)).toBe(true);
    expect(r.isIgnored('src/a.tmp', false)).toBe(true);
    expect(r.isIgnored('other/a.tmp', false)).toBe(false);
  });

  it('glob patterns do not match across slashes for single *', () => {
    const r = rules(['src/*.nested']);
    expect(r.isIgnored('src/deep/file.nested', false)).toBe(false);
  });

  it('supports ** to match across directories', () => {
    const r = rules(['**/*.generated.ts']);
    expect(r.isIgnored('a/b/c/file.generated.ts', false)).toBe(true);
  });

  it('a later negation rule can re-include a path', () => {
    const r = rules(['*.log', '!important.log']);
    expect(r.isIgnored('a.log', false)).toBe(true);
    expect(r.isIgnored('important.log', false)).toBe(false);
  });

  it('comments and blank lines are ignored', () => {
    const r = rules(['# comment', '', 'node_modules']);
    expect(r.isIgnored('node_modules', true)).toBe(true);
  });

  it('always ignores the secret .env file', () => {
    const r = rules([]);
    expect(DEFAULT_IGNORE_PATTERNS).toContain('.env');
    expect(r.isIgnored('.env', false)).toBe(true);
  });
});