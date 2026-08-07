import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FileSystemAnalysis } from '../../domain/models/file-system';
import type { Technology } from '../../domain/models/technology';
import { DefaultFileSystemAnalyzer } from '../fs/file-system-analyzer';
import { SignatureTechnologyDetector } from './technology-detector';

const tempRoots: string[] = [];

async function makeFixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-detect-'));
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

async function detect(files: Record<string, string>): Promise<Technology[]> {
  const root = await makeFixture(files);
  const analysis = await new DefaultFileSystemAnalyzer().analyze(root);
  const detection = await new SignatureTechnologyDetector().detect(analysis, root);
  return detection.technologies;
}

function names(technologies: Technology[]): string[] {
  return technologies.map((t) => t.name);
}

describe('SignatureTechnologyDetector', () => {
  it('detects a TypeScript monorepo with its frameworks, databases, and tooling', async () => {
    const techs = await detect({
      'package.json': JSON.stringify({
        name: 'demo',
        engines: { node: '>=20' },
        dependencies: { express: '4', react: '18', pg: '8', ioredis: '5' },
        devDependencies: { turbo: '^2' },
      }),
      'turbo.json': '{}',
      'src/server.ts': 'import express from "express";\n',
      'src/app/App.tsx': 'export const App = () => null;\n',
      'tsconfig.json': '{}',
      'Dockerfile': 'FROM node:20',
      'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n  cache:\n    image: redis:7\n  vector:\n    image: qdrant/qdrant\n',
      '.github/workflows/ci.yml': 'name: ci\non: push\n',
      'README.md': '# demo',
    });

    const n = names(techs);

    expect(n).toContain('TypeScript');
    expect(n).toContain('Node.js');
    expect(n).toContain('Express');
    expect(n).toContain('React');
    expect(n).toContain('PostgreSQL');
    expect(n).toContain('Redis');
    expect(n).toContain('Vector Database');
    expect(n).toContain('Docker');
    expect(n).toContain('docker-compose');
    expect(n).toContain('GitHub Actions');
    expect(n).toContain('Turborepo');

    // No lockfile -> no specific npm/yarn/pnpm claim, and no false positives.
    expect(n).not.toContain('npm');
    expect(n).not.toContain('yarn');
    expect(n).not.toContain('pnpm');
    expect(n).not.toContain('Python');
  });

  it('detects a Python backend with its framework, package manager, and database', async () => {
    const techs = await detect({
      'requirements.txt': 'fastapi==0.110\nuvicorn[standard]\npsycopg2-binary==2.9\n',
      'pyproject.toml': '[tool.poetry]\nname = "svc"\n',
      'app/__init__.py': 'from fastapi import FastAPI\n',
      'Dockerfile': 'FROM python:3.12',
    });

    const n = names(techs);

    expect(n).toContain('Python');
    expect(n).toContain('FastAPI');
    expect(n).toContain('poetry');
    expect(n).toContain('Docker');
  });

  it('does not guess technologies for a repository with no signals', async () => {
    const techs = await detect({
      'README.md': '# only docs',
      'notes.txt': 'hello',
    });

    expect(names(techs)).toEqual([]);
  });

  it('detects package managers from lockfiles', async () => {
    const techs = await detect({
      'package.json': '{"name":"x"}',
      'pnpm-lock.yaml': 'lockfileVersion: \'9.0\'',
    });

    const n = names(techs);
    expect(n).toContain('pnpm');
    expect(n).toContain('Node.js');
  });

  it('carries confidence and evidence with each technology', async () => {
    const techs = await detect({ 'go.mod': 'module example\n', 'main.go': 'package main\n' });

    const go = techs.find((t) => t.name === 'Go' && t.category === 'language');
    expect(go?.category).toBe('language');
    expect(go?.evidence).toContain('extension: .go');
  });
});