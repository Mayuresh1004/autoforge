import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRuntimeConfig } from './runtime-config-resolver';
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
  it('Mode 1: uses the repository-provided Dockerfile', async () => {
    const dir = await tempRepo({ Dockerfile: 'FROM node:20-alpine\nCMD ["node", "index.js"]\n', 'app.js': 'console.log(1)' });
    const { config } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('DOCKERFILE');
    expect(config.dockerfile?.path).toBe('Dockerfile');
    expect(config.generatedDockerfile).toBeUndefined();
  });

  it('Mode 1: an empty Dockerfile is rejected as unsupported', async () => {
    const dir = await tempRepo({ Dockerfile: '   \n' });
    await expect(resolveRuntimeConfig(dir)).rejects.toBeInstanceOf(UnsupportedRuntimeError);
  });

  it('Mode 1 without a CMD: start command is derived from the repo stack (npm start)', async () => {
    // NodeGoat-shaped: Dockerfile ships no CMD; the image default CMD would be
    // the node REPL (exits immediately) — the resolver must derive `npm start`.
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
      Dockerfile: 'FROM node:20-alpine\nCMD [\"node\", \"index.js\"]\n',
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
    expect(generatedDockerfile).toContain('pip install --no-cache-dir -r requirements.txt');
    expect(generatedDockerfile).toContain('CMD [\"python\", \"app.py\"]');
  });

  it('Mode 2 python: pyproject without entrypoint defaults to app.py', async () => {
    const dir = await tempRepo({ 'pyproject.toml': '[project]\n' });
    const { config } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('PYTHON');
  });

  it('Mode 2 node: package.json with start script', async () => {
    const dir = await tempRepo({ 'package.json': JSON.stringify({ scripts: { start: 'node index.js' } }) });
    const { config, generatedDockerfile } = await resolveRuntimeConfig(dir);
    expect(config.strategy).toBe('NODE');
    expect(config.port).toBe(3000);
    expect(generatedDockerfile).toContain('npm install --omit=dev');
  });

  it('node without start script → unsupported', async () => {
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
});