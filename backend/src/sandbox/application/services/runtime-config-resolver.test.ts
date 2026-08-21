import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRuntimeConfig, parseExposePort } from './runtime-config-resolver';
import { UnsupportedRuntimeError } from '../../domain/errors/runtime-sandbox.errors';

async function tempRepo(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rt-resolver-'));
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

describe('resolveRuntimeConfig', () => {
  it('Mode 1: uses the repository-provided Dockerfile and detects EXPOSE port', async () => {
    const dir = await tempRepo({ Dockerfile: 'FROM node:24\nEXPOSE 3000\nCMD ["node", "index.js"]\n', 'app.js': 'console.log(1)' });
    const { config } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('DOCKERFILE');
    expect(config.port).toBe(3000);
    expect(config.dockerfile?.path).toBe('Dockerfile');
    expect(config.generatedDockerfile).toBeUndefined();
  });

  it('parseExposePort: extracts last EXPOSE instruction correctly', () => {
    expect(parseExposePort('FROM node:20\nEXPOSE 8080\n')).toBe(8080);
    expect(parseExposePort('FROM node:20\nEXPOSE 3000/tcp\n')).toBe(3000);
    expect(parseExposePort('FROM node:20\nEXPOSE 80\nFROM distroless\nEXPOSE 3000\n')).toBe(3000);
    expect(parseExposePort('FROM node:20\n')).toBeNull();
  });

  it('Mode 1: an empty Dockerfile is rejected as unsupported', async () => {
    const dir = await tempRepo({ Dockerfile: '   \n' });
    await expect(resolveRuntimeConfig(dir)).rejects.toBeInstanceOf(UnsupportedRuntimeError);
  });

  it('Mode 1 without a CMD: start command is derived from the repo stack (npm start)', async () => {
    const dir = await tempRepo({
      Dockerfile: 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\n',
      'package.json': JSON.stringify({ scripts: { start: 'node server.js' } }),
      'server.js': 'require("http").createServer().listen(process.env.PORT||4000)',
    });
    const { config } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('DOCKERFILE');
    expect(config.command).toEqual(['npm', 'start']);
  });

  it('Mode 1 without a CMD: python entrypoint derived for python stacks', async () => {
    const dir = await tempRepo({
      Dockerfile: 'FROM python:3.11-slim\nCOPY . .\n',
      'app.py': 'print(1)',
    });
    const { config } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('DOCKERFILE');
    expect(config.command).toEqual(['python', 'app.py']);
  });

  it('Mode 1 with a declared CMD keeps image-CMD behavior (command [])', async () => {
    const dir = await tempRepo({
      Dockerfile: 'FROM node:20-alpine\nCMD ["node", "index.js"]\n',
      'package.json': JSON.stringify({ scripts: { start: 'node other.js' } }),
    });
    const { config } = await resolveRuntimeConfig(dir);
    expect(config.command).toEqual([]);
  });

  it('Mode 1 without CMD and unrecognizable stack → no fallback command', async () => {
    const dir = await tempRepo({ Dockerfile: 'FROM scratch\nCOPY . .\n', 'main.rs': 'fn main(){}' });
    const { config } = await resolveRuntimeConfig(dir);
    expect(config.command).toEqual([]);
  });

  it('Mode 2 python: requirements.txt present → generated Dockerfile installs deps', async () => {
    const dir = await tempRepo({ 'requirements.txt': 'flask\n', 'app.py': 'print(1)' });
    const { config, generatedDockerfile } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('PYTHON');
    expect(config.port).toBe(8000);
    expect(config.recipe?.baseImage).toContain('python');
    expect(generatedDockerfile).toContain('pip install');
    expect(generatedDockerfile).toContain('requirements.txt');
    expect(generatedDockerfile).toContain('ENV GITHUB_WEBHOOK_SECRET=amass_runtime_dev_secret');
    expect(generatedDockerfile).toContain('ENV SUPABASE_URL=http://localhost:54321');
    expect(generatedDockerfile).toContain('ENV REDIS_URL=redis://localhost:6379');
    expect(generatedDockerfile).toContain('CMD ["python", "app.py"]');
  });

  it('Mode 2 python: pyproject without entrypoint defaults to app.py', async () => {
    const dir = await tempRepo({ 'pyproject.toml': '[project]\n' });
    const { config } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('PYTHON');
  });

  it('Mode 2 node: simple npm repository', async () => {
    const dir = await tempRepo({ 'package.json': JSON.stringify({ scripts: { start: 'node index.js' } }) });
    const { config, generatedDockerfile } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('NODE');
    expect(config.port).toBe(3000);
    expect(generatedDockerfile).toContain('FROM node:20-alpine');
    expect(generatedDockerfile).toContain('ENV HOST=0.0.0.0');
    expect(generatedDockerfile).toContain('COPY . .');
    expect(generatedDockerfile).toContain('npm install --no-audit --no-fund');
    expect(generatedDockerfile).toContain('CMD ["npm", "start"]');
  });

  it('Mode 2 node: pnpm repository with pnpm-lock.yaml', async () => {
    const dir = await tempRepo({
      'pnpm-lock.yaml': 'lockfileVersion: 5.4\n',
      'package.json': JSON.stringify({ scripts: { start: 'node index.js' } }),
    });
    const { config, generatedDockerfile } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('NODE');
    expect(generatedDockerfile).toContain('pnpm install');
    expect(generatedDockerfile).toContain('CMD ["pnpm", "start"]');
  });

  it('Mode 2 node: yarn repository with yarn.lock', async () => {
    const dir = await tempRepo({
      'yarn.lock': '# yarn lockfile v1\n',
      'package.json': JSON.stringify({ scripts: { start: 'node index.js' } }),
    });
    const { config, generatedDockerfile } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('NODE');
    expect(generatedDockerfile).toContain('yarn install');
    expect(generatedDockerfile).toContain('CMD ["yarn", "start"]');
  });

  it('Mode 2 node: nested frontend/backend Node repository', async () => {
    const dir = await tempRepo({
      'frontend/package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
      'backend/package.json': JSON.stringify({ scripts: { start: 'node server.js' } }),
    });
    const { config, generatedDockerfile } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('NODE');
    expect(generatedDockerfile).toContain('RUN cd backend && npm install');
    expect(generatedDockerfile).toContain('CMD ["npm", "start", "--prefix", "backend"]');
  });

  it('Mode 2 node: Node repository with engines.node "22 - 26"', async () => {
    const dir = await tempRepo({
      'package.json': JSON.stringify({ engines: { node: '22 - 26' }, scripts: { start: 'node index.js' } }),
    });
    const { config, generatedDockerfile } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('NODE');
    expect(generatedDockerfile).toContain('FROM node:22-alpine');
  });

  it('Mode 2 node: repository requiring npm run build', async () => {
    const dir = await tempRepo({
      'package.json': JSON.stringify({ scripts: { build: 'tsc', start: 'node build/app.js' } }),
    });
    const { config, generatedDockerfile } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('NODE');
    expect(generatedDockerfile).toContain('RUN npm run build');
    expect(generatedDockerfile).toContain('CMD ["npm", "start"]');
  });

  it('Mode 2 node: repository whose start script uses PORT=8080', async () => {
    const dir = await tempRepo({
      'package.json': JSON.stringify({ scripts: { start: 'node server.js --port 8080' } }),
    });
    const { config, generatedDockerfile } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('NODE');
    expect(config.port).toBe(8080);
    expect(generatedDockerfile).toContain('ENV PORT=8080');
    expect(generatedDockerfile).toContain('EXPOSE 8080');
  });

  it('node without start/serve/dev script → unsupported', async () => {
    const dir = await tempRepo({ 'package.json': JSON.stringify({ name: 'x' }) });
    await expect(resolveRuntimeConfig(dir)).rejects.toBeInstanceOf(UnsupportedRuntimeError);
  });

  it('unrecognized stack → UnsupportedRuntimeError with hints', async () => {
    const dir = await tempRepo({ 'run.sh': '#!/bin/sh\n' });
    const err = await resolveRuntimeConfig(dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedRuntimeError);
  });

  it('port override applies to generated modes and Dockerfile mode', async () => {
    const py = await tempRepo({ 'app.py': 'x' });
    expect((await resolveRuntimeConfig(py, 9001)).config.port).toBe(9001);
    const df = await tempRepo({ Dockerfile: 'FROM scratch\nCOPY . .\n' });
    expect((await resolveRuntimeConfig(df, 9001)).config.port).toBe(9001);
  });

  it('Mode 2 python monorepo: detects nested backend requirements and main.py (RepoMind layout)', async () => {
    const dir = await tempRepo({
      'README.md': '# RepoMind\n',
      'backend/requirements.txt': 'fastapi==0.127.0\nuvicorn==0.40.0\n',
      'backend/app/main.py': 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/health")\ndef health(): return {"status": "ok"}\n',
      'frontend/package.json': JSON.stringify({ name: 'frontend', scripts: { dev: 'vite' } }),
    });
    const { config, generatedDockerfile } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('PYTHON');
    expect(config.port).toBe(8000);
    expect(generatedDockerfile).toContain('pip install');
    expect(generatedDockerfile).toContain('requirements.txt');
    expect(generatedDockerfile).toContain('PYTHONPATH=');
    expect(generatedDockerfile).toContain('backend/app/main.py');
  });

  it('Mode 2 node: generic Next.js + TypeScript-config repository (next.config.ts) installs devDependencies before building', async () => {
    const dir = await tempRepo({
      'next.config.ts': 'import type { NextConfig } from "next"; const config: NextConfig = {}; export default config;',
      'tsconfig.json': '{\n  "compilerOptions": { "module": "esnext" }\n}',
      'package.json': JSON.stringify({
        scripts: { build: 'next build', start: 'next start' },
        dependencies: { next: '^14.0.0', react: '^18.0.0' },
        devDependencies: { typescript: '^5.0.0', '@types/node': '^20.0.0' },
      }),
    });
    const { config, generatedDockerfile } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('NODE');
    expect(generatedDockerfile).toBeDefined();

    const installIdx = generatedDockerfile!.indexOf('npm install');
    const buildIdx = generatedDockerfile!.indexOf('npm run build');
    const nodeEnvIdx = generatedDockerfile!.indexOf('ENV NODE_ENV=production');

    expect(installIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(installIdx);
    expect(nodeEnvIdx).toBeGreaterThan(buildIdx);
  });
});