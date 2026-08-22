import { describe, expect, it } from 'vitest';
import { buildUnifiedDiff } from './diff-builder';

describe('buildUnifiedDiff', () => {
  it('generates a standard unified diff for changed lines', () => {
    const orig = 'const query = `SELECT * FROM users WHERE id = ${id}`;';
    const patch = 'const query = "SELECT * FROM users WHERE id = ?";';
    const diff = buildUnifiedDiff('src/vulnerable.ts', orig, patch);

    expect(diff).toContain('--- a/src/vulnerable.ts');
    expect(diff).toContain('+++ b/src/vulnerable.ts');
    expect(diff).toContain('@@ -1,1 +1,1 @@');
    expect(diff).toContain(`-${orig}`);
    expect(diff).toContain(`+${patch}`);
  });

  it('handles multi-line additions and deletions with context', () => {
    const orig = ['def get_user():', '    id = request.args.get("id")', '    query = f"SELECT * FROM users WHERE id = \'{id}\'"', '    return db.query(query)'].join('\n');
    const patch = ['def get_user():', '    id = request.args.get("id")', '    query = "SELECT * FROM users WHERE id = %s"', '    return db.query(query, (id,))'].join('\n');

    const diff = buildUnifiedDiff('app.py', orig, patch);

    expect(diff).toContain('--- a/app.py');
    expect(diff).toContain('+++ b/app.py');
    expect(diff).toContain(' def get_user():');
    expect(diff).toContain('     id = request.args.get("id")');
    expect(diff).toContain('-    query = f"SELECT * FROM users WHERE id = \'{id}\'"');
    expect(diff).toContain('-    return db.query(query)');
    expect(diff).toContain('+    query = "SELECT * FROM users WHERE id = %s"');
    expect(diff).toContain('+    return db.query(query, (id,))');
  });

  it('handles empty original code (pure addition)', () => {
    const patch = 'const safe = true;';
    const diff = buildUnifiedDiff('src/new.ts', '', patch);

    expect(diff).toContain('--- a/src/new.ts');
    expect(diff).toContain('+++ b/src/new.ts');
    expect(diff).toContain('+const safe = true;');
  });

  it('handles empty patched code (pure deletion)', () => {
    const orig = 'const unsafe = true;';
    const diff = buildUnifiedDiff('src/old.ts', orig, '');

    expect(diff).toContain('--- a/src/old.ts');
    expect(diff).toContain('+++ b/src/old.ts');
    expect(diff).toContain('-const unsafe = true;');
  });
});
