import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FileSystemAnalysis } from '../../domain/models/file-system';
import type { ApiInventory } from '../../domain/models/api';
import { DefaultFileSystemAnalyzer } from '../fs/file-system-analyzer';
import { RegexApiAnalyzer } from './api-analyzer';

const tempRoots: string[] = [];

async function makeFixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-api-'));
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

async function analyze(files: Record<string, string>): Promise<ApiInventory> {
  const root = await makeFixture(files);
  const analysis: FileSystemAnalysis = await new DefaultFileSystemAnalyzer().analyze(root);
  return new RegexApiAnalyzer().analyze(analysis, root);
}

function endpointStrings(inventory: ApiInventory): string[] {
  return inventory.endpoints.map((e) => `${e.method} ${e.path}`);
}

describe('RegexApiAnalyzer', () => {
  it('discovers Express routes including router mounts', async () => {
    const inventory = await analyze({
      'src/server.ts': [
        "import express from 'express';",
        'const app = express();',
        "app.get('/health', (_req, res) => res.send('ok'));",
        "app.use('/api', usersRouter);",
        "router.post('/users', createUser);",
      ].join('\n'),
    });

    const routes = endpointStrings(inventory);
    expect(routes).toContain('GET /health');
    expect(routes).toContain('ANY /api');
    expect(routes).toContain('POST /users');
    expect(inventory.protocols).toContain('rest');
  });

  it('discovers FastAPI decorator routes', async () => {
    const inventory = await analyze({
      'main.py': [
        'from fastapi import FastAPI',
        'app = FastAPI()',
        "@app.get('/')",
        'def root():',
        '    return {"hello": "world"}',
        "@app.post('/items')",
        'def create_item():',
        '    ...',
      ].join('\n'),
    });

    const routes = endpointStrings(inventory);
    expect(routes).toContain('GET /');
    expect(routes).toContain('POST /items');
  });

  it('detects GraphQL and WebSocket protocols from manifests and schema files', async () => {
    const inventory = await analyze({
      'package.json': JSON.stringify({
        name: 'realtime-api',
        dependencies: { graphql: '16', 'socket.io': '4', express: '4' },
      }),
      'schema.graphql': 'type Query { hello: String }',
      'src/index.ts': "import { Server } from 'socket.io';\n",
    });

    expect(inventory.protocols).toContain('graphql');
    expect(inventory.protocols).toContain('websocket');
    expect(inventory.graphqlSources).toContain('schema.graphql');
  });

  it('discovers Go Gin routes and Spring Java mappings', async () => {
    const inventory = await analyze({
      'main.go': [
        'package main',
        'r := gin.Default()',
        'r.GET("/ping", pong)',
        'r.POST("/users", createUser)',
      ].join('\n'),
      'src/main/java/com/demo/UserController.java': [
        'package com.demo;',
        '@RestController',
        'public class UserController {',
        '  @GetMapping("/users")',
        '  public String list() { return ""; }',
        '  @RequestMapping(value = "/admin")',
        '  public String admin() { return ""; }',
        '}',
      ].join('\n'),
    });

    const routes = endpointStrings(inventory);
    expect(routes).toContain('GET /ping');
    expect(routes).toContain('POST /users');
    expect(routes).toContain('GET /users');
    expect(routes).toContain('ANY /admin');
  });

  it('discovers Laravel routes only in route files', async () => {
    const inventory = await analyze({
      'routes/web.php': "Route::get('/home', [HomeController::class, 'index']);",
      'src/Helpers.php': "helper('get', '/not-a-route');",
    });

    const routes = endpointStrings(inventory);
    expect(routes).toContain('GET /home');
    expect(routes).not.toContain('GET /not-a-route');
  });

  it('returns no endpoints for a repo without route declarations', async () => {
    const inventory = await analyze({
      'src/util.ts': 'export const add = (a: number, b: number) => a + b;\n',
      'README.md': '# util repo',
    });

    expect(inventory.endpoints).toHaveLength(0);
    expect(inventory.protocols).toHaveLength(0);
  });
});
