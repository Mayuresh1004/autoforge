import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DirectoryNode } from '../../domain/models/file-system';
import { DefaultFileSystemAnalyzer } from './file-system-analyzer';

const tempRoots: string[] = [];

async function makeFixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-fs-'));
  tempRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const full = path.join(root, relativePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  return root;
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function collectFilePaths(node: DirectoryNode): string[] {
  const own = node.files.map((f) => f.relativePath);
  for (const child of node.directories) {
    own.push(...collectFilePaths(child));
  }
  return own;
}

function maxDepth(node: DirectoryNode): number {
  if (node.directories.length === 0) return 0;
  return 1 + Math.max(...node.directories.map(maxDepth));
}

const analyzer = new DefaultFileSystemAnalyzer();

describe('DefaultFileSystemAnalyzer', () => {
  it('walks a real nested tree and aggregates statistics', async () => {
    const root = await makeFixture({
      'src/index.ts': 'const a = 1;\nconst b = 2;\n', // 2 lines
      'src/utils/helper.ts': 'export const x = 1;\n', // 1 line
      'package.json': '{}',
      'README.md': '# hi\n',
    });

    const analysis = await analyzer.analyze(root);

    expect(analysis.fileCount).toBe(4);
    expect(analysis.folderCount).toBe(2); // src, src/utils
    expect(analysis.totalSizeBytes).toBeGreaterThan(0);
    expect(analysis.linesOfCode).toBe(4); // 2 (index.ts) + 1 (helper.ts) + 1 (README.md)
    expect(analysis.filesByExtension['ts']).toBe(2);
    expect(analysis.filesByExtension['json']).toBe(1);
    expect(analysis.filesByExtension['md']).toBe(1);
  });

  it('skips generated, version-control, and secret files/dirs by default', async () => {
    const root = await makeFixture({
      'src/app.ts': 'code()\n',
      'node_modules/dep/index.js': 'DEP\n',
      '.git/objects/ab/x': 'DATA',
      'dist/bundle.js': 'BUNDLE\n',
      'target/x.rs': 'RS\n',
      '.env': 'SECRET=1\n',
      '.env.example': 'SECRET=\n',
    });

    const analysis = await analyzer.analyze(root);
    const paths = collectFilePaths(analysis.tree);

    expect(analysis.fileCount).toBe(2); // app.ts + .env.example
    expect(paths).toContain('src/app.ts');
    expect(paths).toContain('.env.example');
    expect(paths).not.toContain('.env');
    expect(paths).not.toContain('node_modules/dep/index.js');
    expect(paths).not.toContain('dist/bundle.js');
    expect(paths).not.toContain('.git/index.js');
  });

  it('reports the largest files and largest directories', async () => {
    const root = await makeFixture({
      'src/small.ts': 'export {};\n',
      'src/big.md': 'x'.repeat(5_000),
      'vendor/lib/lib.bin': 'y'.repeat(9_000), // ignored by default
    });

    const analysis = await analyzer.analyze(root);

    expect(analysis.largestFiles[0].relativePath).toBe('src/big.md');
    expect(analysis.largestDirectories[0].relativePath).toBe('src');
  });

  it('detects important files and marks their categories', async () => {
    const root = await makeFixture({
      'package.json': '{}',
      'Dockerfile': 'FROM node',
      'src/lib/model.ts': 'x',
      '.github/workflows/ci.yml': 'name: ci',
    });

    const analysis = await analyzer.analyze(root);
    const byName = new Map(analysis.importantFiles.map((f) => [f.name, f]));

    expect(byName.get('package.json')?.category).toBe('manifest');
    expect(byName.get('Dockerfile')?.category).toBe('container');
    const workflows = byName.get('.github/workflows');
    expect(workflows?.category).toBe('ci');
    expect(workflows?.relativePath).toBe('.github/workflows');
  });

  it('returns the full statistics but truncates the output tree by depth', async () => {
    const root = await makeFixture({ 'a/b/c/d/e.ts': 'x\n' });

    const analysis = await analyzer.analyze(root, { maxTreeDepth: 2 });

    expect(analysis.fileCount).toBe(1);
    expect(maxDepth(analysis.tree)).toBeLessThanOrEqual(2);
  });

  it('honours extra ignore patterns', async () => {
    const root = await makeFixture({
      'src/code.ts': 'x\n',
      'generated.out.ts': 'x\n',
    });

    const analysis = await analyzer.analyze(root, { ignorePatterns: ['generated.out.ts'] });
    const paths = collectFilePaths(analysis.tree);

    expect(paths).toContain('src/code.ts');
    expect(paths).not.toContain('generated.out.ts');
  });
});