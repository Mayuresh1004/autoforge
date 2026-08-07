import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DefaultFileSystemAnalyzer } from './fs/file-system-analyzer';
import { DefaultDependencyAnalyzer } from './dependency-analyzer';

const tempRoots: string[] = [];

async function makeFixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-deps-'));
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

async function analyze(files: Record<string, string>) {
  const root = await makeFixture(files);
  const analysis = await new DefaultFileSystemAnalyzer().analyze(root);
  return new DefaultDependencyAnalyzer().analyze(analysis, root);
}

describe('DefaultDependencyAnalyzer', () => {
  it('parses a Node package.json with versions, scopes, runtimes, and categories', async () => {
    const result = await analyze({
      'package.json': JSON.stringify({
        engines: { node: '>=20', npm: '>=10' },
        dependencies: {
          express: '^5.0.0',
          react: '^18.3.0',
          pg: '^8.11.0',
        },
        devDependencies: { vitest: '^2.0.0' },
      }),
    });

    const npm = result.summaries.find((s) => s.ecosystem === 'npm');
    expect(npm).toBeDefined();
    expect(npm?.count).toBe(4);
    expect(npm?.runtimes.node).toBe('>=20');
    expect(npm?.dependencies.find((d) => d.name === 'express')?.version).toBe('^5.0.0');
    expect(npm?.dependencies.find((d) => d.name === 'pg')?.categories).toContain('database');
    expect(npm?.dependencies.find((d) => d.name === 'bcrypt' || d.name === 'vitest')).toBeDefined();
    expect(npm?.dependencies.find((d) => d.name === 'vitest')?.scope).toBe('development');
    // Whole-repo library classification for key categories.
    expect(npm?.librariesByCategory.database).toContain('pg');
    expect(npm?.librariesByCategory.test).toContain('vitest');
  });

  it('categorises auth, security, orm and ai libraries', async () => {
    const result = await analyze({
      'package.json': JSON.stringify({
        dependencies: {
          jsonwebtoken: '9', passport: '0.7', helmet: '8', prisma: '^5', 'sharp': '0'
        },
      }),
    });

    const npm = result.summaries.find((s) => s.ecosystem === 'npm');
    expect(npm?.librariesByCategory.auth).toContain('passport');
    expect(npm?.librariesByCategory.auth).toContain('jsonwebtoken');
    expect(npm?.librariesByCategory.security).toContain('helmet');
    expect(npm?.librariesByCategory.orm).toContain('prisma');
  });

  it('parses requirements.txt and pyproject.toml (poetry) python dependencies', async () => {
    const result = await analyze({
      'requirements.txt': 'fastapi==0.110\nuvicorn[standard]==0.29\npsycopg2-binary==2.9\n',
      'pyproject.toml': '[tool.poetry]\nname = "svc"\n\n[tool.poetry.dependencies]\npython = "^3.12"\nlangchain = "^0.1"\n',
    });

    const req = result.summaries.find((s) => s.ecosystem === 'requirements.txt');
    expect(req?.count).toBe(3);
    expect(req?.librariesByCategory.framework).toContain('fastapi');
    expect(req?.librariesByCategory.database).toContain('psycopg2-binary');

    const pyproject = result.summaries.find((s) => s.ecosystem === 'pyproject.toml');
    expect(pyproject?.librariesByCategory.ai).toContain('langchain');
    expect(pyproject?.count).toBe(1);
  });

  it('parses go.mod dependencies and module runtime version', async () => {
    const result = await analyze({
      'go.mod': 'module github.com/example/api\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n\tgithub.com/jackc/pgx/v5 v5.5.0\n)\n',
    });

    const mod = result.summaries.find((s) => s.ecosystem === 'go.mod');
    expect(mod?.runtimes.go).toBe('1.22');
    expect(mod?.count).toBeGreaterThanOrEqual(1);
    expect(mod?.dependencies.find((d) => d.name.includes('gin')).categories).toContain('framework');
  });

  it('parses Maven pom.xml with a resolvable property version and spring-boot', async () => {
    const result = await analyze({
      'pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <properties>
    <java.version>21</java.version>
    <spring-boot.version>3.2.0</spring-boot.version>
  </properties>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId><version>\${spring-boot.version}</version></dependency>
    <dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId><version>42.6.0</version></dependency>
  </dependencies>
</project>`,
    });

    const maven = result.summaries.find((s) => s.ecosystem === 'maven');
    expect(maven?.count).toBe(2);
    const spring = maven?.dependencies.find((d) => d.name.includes('spring-boot'));
    expect(spring?.version).toBe('3.2.0'); // property resolved
    expect(spring?.categories).toContain('framework');
    expect(maven?.dependencies.find((d) => d.name.endsWith(':postgresql'))?.categories).toContain('database');
    expect(maven?.runtimes.java).toBe('21');
  });

  it('does not emit summaries for missing manifests', async () => {
    const result = await analyze({ 'README.md': '# only docs' });
    expect(result.summaries).toEqual([]);
  });
});