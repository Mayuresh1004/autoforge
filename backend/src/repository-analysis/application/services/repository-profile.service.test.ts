import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RepositoryProfileService } from './repository-profile.service';
import { RepositoryCloningService } from './repository-cloning.service';
import { GitRepositoryCloner } from '../../infrastructure/git/git-repository-cloner';
import { DefaultFileSystemAnalyzer } from '../../infrastructure/fs/file-system-analyzer';
import { SignatureTechnologyDetector } from '../../infrastructure/detection/technology-detector';
import { DefaultDependencyAnalyzer } from '../../infrastructure/dependency-analyzer';
import { SignatureArchitectureAnalyzer } from '../../infrastructure/analyzers/architecture-analyzer';
import { RegexApiAnalyzer } from '../../infrastructure/analyzers/api-analyzer';
import { RegexAuthenticationAnalyzer } from '../../infrastructure/analyzers/authentication-analyzer';
import { InvalidRepositoryUrlError } from '../../domain/errors/repository-analysis.errors';
import type { RepositoryUrlResolver } from '../../domain/ports/repository-url-resolver';
import { createGitRepoFixture } from '../../../../test/helpers/git-repo';

function fakeResolver(cloneUrl: string): RepositoryUrlResolver {
  return {
    parse: () => ({
      provider: 'github',
      owner: 'test',
      name: 'repo',
      cloneUrl,
      homepageUrl: 'https://github.com/test/repo',
      defaultBranch: 'main',
    }),
  };
}

function makeService(workspaceDir: string, cloneUrl: string, keepRepoDir = false): RepositoryProfileService {
  return new RepositoryProfileService({
    cloning: new RepositoryCloningService({
      resolver: fakeResolver(cloneUrl),
      cloner: new GitRepositoryCloner({ timeoutMs: 30_000 }),
      workspaceDir,
      maxRepoBytes: 1_000_000_000,
    }),
    fileSystemAnalyzer: new DefaultFileSystemAnalyzer(),
    technologyDetector: new SignatureTechnologyDetector(),
    dependencyAnalyzer: new DefaultDependencyAnalyzer(),
    architectureAnalyzer: new SignatureArchitectureAnalyzer(),
    apiAnalyzer: new RegexApiAnalyzer(),
    authenticationAnalyzer: new RegexAuthenticationAnalyzer(),
    keepRepoDir,
  });
}

describe('RepositoryProfileService (full pipeline)', () => {
  const workspaces: string[] = [];

  async function makeWorkspace(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-profile-'));
    workspaces.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const workspace of workspaces.splice(0)) {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('clones and analyzes a repository into a complete profile, then cleans up', async () => {
    const fixture = await createGitRepoFixture({
      'README.md': '# acme-api\n',
      'package.json': JSON.stringify({
        name: 'acme-api',
        version: '1.0.0',
        engines: { node: '>=20' },
        dependencies: { express: '4.19.2', pg: '8.11.3', graphql: '16.8.1', jsonwebtoken: '9.0.2' },
        devDependencies: { typescript: '5.4.5' },
      }),
      'tsconfig.json': '{}',
      'src/server.ts': [
        "import express from 'express';",
        "import { authMiddleware } from './middleware/auth';",
        'const app = express();',
        "app.get('/health', (_req, res) => res.send('ok'));",
        "app.use('/api', router);",
        "router.post('/users', authMiddleware, createUser);",
      ].join('\n'),
      'src/middleware/auth.ts': 'export function authMiddleware(req, res, next) { next(); }\n',
      'schema.graphql': 'type Query { hello: String }\n',
      '.github/workflows/ci.yml': 'name: ci\non: push\n',
    });

    const workspaceDir = await makeWorkspace();
    const service = makeService(workspaceDir, fixture.fileUrl);

    try {
      const profile = await service.analyzeRepository('https://github.com/test/repo');

      // Metadata from cloning.
      expect(profile.meta.owner).toBe('test');
      expect(profile.meta.commitSha).toBe(fixture.commitSha);
      expect(profile.meta.sizeBytes).toBeGreaterThan(0);

      // File-system summary.
      expect(profile.fileSystem.fileCount).toBeGreaterThanOrEqual(5);
      expect(profile.fileSystem.linesOfCode).toBeGreaterThan(0);
      expect(profile.fileSystem.importantFiles).toContain('package.json');
      expect(profile.fileSystem.importantFiles).toContain('README.md');

      // Technologies.
      expect(profile.technologies.primary?.name).toBe('TypeScript');
      const names = profile.technologies.all.map((t) => t.name);
      expect(names).toContain('Express');
      expect(names).toContain('Node.js');

      // Dependencies (npm ecosystem with categorized libraries + runtimes).
      expect(profile.dependencies).toHaveLength(1);
      const npm = profile.dependencies[0];
      expect(npm.ecosystem).toBe('npm');
      expect(npm.count).toBe(5);
      expect(npm.runtimes.node).toBe('>=20');
      expect(npm.librariesByCategory.framework).toContain('express');
      expect(npm.librariesByCategory.database).toContain('pg');
      expect(npm.librariesByCategory.auth).toContain('jsonwebtoken');

      // Architecture.
      expect(profile.architecture.primary).toBe('monolith');

      // API surface.
      expect(profile.api.endpointCount).toBe(3);
      const routes = profile.api.endpoints.map((e) => `${e.method} ${e.path}`);
      expect(routes).toContain('GET /health');
      expect(routes).toContain('POST /users');
      expect(profile.api.protocols).toEqual(expect.arrayContaining(['rest', 'graphql']));
      expect(profile.api.graphqlSources).toContain('schema.graphql');

      // Authentication.
      expect(profile.authentication.schemes).toContain('JWT');
      expect(profile.authentication.libraries).toContain('jsonwebtoken');
      expect(profile.authentication.middleware.some((m) => m.includes('middleware/auth.ts'))).toBe(true);

      // Working tree was cleaned up (keepRepoDir default false).
      const leftovers = await fs.readdir(workspaceDir);
      expect(leftovers).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it('keeps the working tree when keepRepoDir is enabled', async () => {
    const fixture = await createGitRepoFixture({
      'package.json': JSON.stringify({ name: 'mini', dependencies: { express: '4' } }),
      'README.md': '# mini\n',
    });

    const workspaceDir = await makeWorkspace();
    const service = makeService(workspaceDir, fixture.fileUrl, true);

    try {
      const profile = await service.analyzeRepository('https://github.com/test/repo');
      expect(profile.meta.name).toBe('repo');

      const leftovers = await fs.readdir(workspaceDir);
      expect(leftovers).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('propagates invalid URL errors without creating a workspace', async () => {
    const workspaceDir = await makeWorkspace();
    const service = new RepositoryProfileService({
      cloning: new RepositoryCloningService({
        resolver: {
          parse: () => {
            throw new InvalidRepositoryUrlError('https://evil.example/x');
          },
        },
        cloner: new GitRepositoryCloner({ timeoutMs: 30_000 }),
        workspaceDir,
        maxRepoBytes: 1_000_000_000,
      }),
      fileSystemAnalyzer: new DefaultFileSystemAnalyzer(),
      technologyDetector: new SignatureTechnologyDetector(),
      dependencyAnalyzer: new DefaultDependencyAnalyzer(),
      architectureAnalyzer: new SignatureArchitectureAnalyzer(),
      apiAnalyzer: new RegexApiAnalyzer(),
      authenticationAnalyzer: new RegexAuthenticationAnalyzer(),
    });

    await expect(
      service.analyzeRepository('https://evil.example/x')
    ).rejects.toBeInstanceOf(InvalidRepositoryUrlError);

    const leftovers = await fs.readdir(workspaceDir);
    expect(leftovers).toHaveLength(0);
  });
});