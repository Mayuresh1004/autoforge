import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FileSystemAnalysis } from '../../domain/models/file-system';
import type { AuthenticationDetection } from '../../domain/models/authentication';
import { DefaultFileSystemAnalyzer } from '../fs/file-system-analyzer';
import { RegexAuthenticationAnalyzer } from './authentication-analyzer';

const tempRoots: string[] = [];

async function makeFixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-auth-'));
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

async function analyze(files: Record<string, string>): Promise<AuthenticationDetection> {
  const root = await makeFixture(files);
  const analysis: FileSystemAnalysis = await new DefaultFileSystemAnalyzer().analyze(root);
  return new RegexAuthenticationAnalyzer().analyze(analysis, root);
}

describe('RegexAuthenticationAnalyzer', () => {
  it('detects JWT auth from dependencies and locates an auth middleware file', async () => {
    const detection = await analyze({
      'package.json': JSON.stringify({
        name: 'api',
        dependencies: { jsonwebtoken: '9', express: '4' },
      }),
      'src/middleware/auth.ts': 'export function requireAuth(req, res, next) { next(); }\n',
      'src/server.ts': "app.get('/health', requireAuth, handler);\n",
    });

    expect(detection.schemes).toContain('JWT');
    expect(detection.libraries).toContain('jsonwebtoken');
    expect(detection.middleware.some((m) => /auth/.test(m))).toBe(true);
  });

  it('detects managed providers (Clerk + NextAuth) from dependencies', async () => {
    const detection = await analyze({
      'package.json': JSON.stringify({
        dependencies: {
          next: '14',
          'next-auth': '4',
          '@clerk/nextjs': '5',
          react: '18',
        },
      }),
    });

    expect(detection.schemes).toContain('Clerk');
    expect(detection.schemes).toContain('NextAuth');
    expect(detection.libraries).toContain('next-auth');
  });

  it('detects Firebase and Supabase auth schemes', async () => {
    const detection = await analyze({
      'package.json': JSON.stringify({
        dependencies: { firebase: '10', '@supabase/supabase-js': '2' },
      }),
    });

    expect(detection.schemes).toEqual(expect.arrayContaining(['Firebase', 'Supabase']));
  });

  it('returns empty detection (no auth) for a dependency-free repo', async () => {
    const detection = await analyze({
      'src/server.ts': 'export const sum = (a: number, b: number): number => a + b;\n',
      'README.md': '# plain util',
    });

    expect(detection.schemes).toHaveLength(0);
    expect(detection.libraries).toHaveLength(0);
    expect(detection.middleware).toHaveLength(0);
  });
});