import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FileSystemAnalysis } from '../../domain/models/file-system';
import type { ArchitectureDetection } from '../../domain/models/architecture';
import { DefaultFileSystemAnalyzer } from '../fs/file-system-analyzer';
import { SignatureArchitectureAnalyzer } from './architecture-analyzer';

const tempRoots: string[] = [];

async function makeFixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-arch-'));
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

async function analyze(files: Record<string, string>): Promise<ArchitectureDetection> {
  const root = await makeFixture(files);
  const analysis: FileSystemAnalysis = await new DefaultFileSystemAnalyzer().analyze(root);
  return new SignatureArchitectureAnalyzer().analyze(analysis, root);
}

describe('SignatureArchitectureAnalyzer', () => {
  it('detects a monorepo from workspace manifests and nested package.json files', async () => {
    const detection = await analyze({
      'package.json': JSON.stringify({ name: 'root', private: true }),
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n',
      'apps/api/package.json': JSON.stringify({ name: 'api' }),
      'apps/web/package.json': JSON.stringify({ name: 'web' }),
      'packages/ui/package.json': JSON.stringify({ name: 'ui' }),
    });

    expect(detection.primary?.type).toBe('monorepo');
    expect(detection.primary?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(detection.primary?.evidence.some((e) => e.includes('workspace manifest'))).toBe(true);
  });

  it('detects clean architecture from domain/application/infrastructure/presentation layers', async () => {
    const detection = await analyze({
      'src/domain/entities/user.ts': 'export interface User { id: string }\n',
      'src/application/services/user-service.ts': 'export class UserService {}\n',
      'src/infrastructure/db/repository.ts': 'export class Repository {}\n',
      'src/presentation/controllers/user.controller.ts': 'export class UserController {}\n',
    });

    expect(detection.primary?.type).toBe('clean');
    expect(detection.primary?.evidence.some((e) => e.includes('domain'))).toBe(true);
  });

  it('detects MVC layout from controllers/models/views directories', async () => {
    const detection = await analyze({
      'controllers/user_controller.rb': 'class UserController\nend\n',
      'models/user.rb': 'class User\nend\n',
      'views/users/index.html.erb': '<h1>Users</h1>\n',
    });

    expect(detection.primary?.type).toBe('mvc');
  });

  it('detects client-server split from client/server directories', async () => {
    const detection = await analyze({
      'client/package.json': JSON.stringify({ name: 'web', dependencies: { react: '18' } }),
      'server/package.json': JSON.stringify({ name: 'api', dependencies: { express: '4' } }),
    });

    expect(detection.primary?.type).toBe('client-server');
  });

  it('prefers microservices when multiple top-level service manifests exist', async () => {
    const detection = await analyze({
      'gateway/package.json': JSON.stringify({ name: 'gateway' }),
      'orders/package.json': JSON.stringify({ name: 'orders' }),
      'billing/package.json': JSON.stringify({ name: 'billing' }),
      'README.md': '# services',
    });

    expect(detection.primary?.type).toBe('microservices');
    expect(detection.candidates.some((c) => c.type === 'monorepo')).toBe(true);
  });

  it('returns no primary (Unknown) for an ambiguous single-app repo', async () => {
    const detection = await analyze({
      'src/main.ts': 'console.log("hi");\n',
      'README.md': '# hello',
    });

    expect(detection.primary).toBeNull();
    expect(detection.candidates).toHaveLength(0);
  });
});
