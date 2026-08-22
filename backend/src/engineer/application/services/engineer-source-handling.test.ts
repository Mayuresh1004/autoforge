import { describe, expect, it, vi } from 'vitest';
import { readSource, prepareEngineerRun } from './engineer-run-context';
import type { ConfirmedVulnerabilityFinding } from '../../domain/ports/confirmed-finding-repository';
import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';
import type { EngineerDependencies } from './engineer.service';
import type { SourceReadResult } from '../../domain/ports/source-reader';

describe('Engineer source path handling', () => {
  const dummyContext: RuntimeSandboxContext = {
    sandboxId: 'sb-1',
    containerId: 'c-1',
    imageName: 'img-1',
    networkId: 'net-1',
    targetUrl: 'http://172.23.0.2:3000',
    internalHost: '172.23.0.2',
    internalPort: 3000,
    exposedPort: 3000,
  };

  const findingWithSource: ConfirmedVulnerabilityFinding = {
    vulnerabilityId: 'vuln-1',
    scanId: 'scan-1',
    exploitId: 'exp-1',
    type: 'SQL_INJECTION',
    status: 'CONFIRMED',
    severity: 'HIGH',
    confidence: 1,
    cwe: 'CWE-89',
    cve: null,
    title: 'SQL injection in search',
    message: 'sqlmap confirmed injection on q',
    filePath: 'server/routes/products.js',
    lineNumber: 42,
    endpoint: 'http://172.23.0.2:3000/api/products/search',
    method: 'GET',
    parameter: 'q',
    evidence: 'UNION query',
    reason: 'sqlmap confirmed injection on q',
    exploitDepth: 1,
    confirmedAt: new Date().toISOString(),
  };

  const findingWithoutSource: ConfirmedVulnerabilityFinding = {
    ...findingWithSource,
    vulnerabilityId: 'vuln-2',
    filePath: null,
    lineNumber: null,
  };

  const findingWithoutContext: ConfirmedVulnerabilityFinding = {
    ...findingWithoutSource,
    vulnerabilityId: 'vuln-3',
    endpoint: null,
    method: null,
    parameter: null,
    evidence: null,
    message: null,
    reason: null,
  };

  it('reads source when filePath is present', async () => {
    const sourceReader = {
      read: vi.fn().mockResolvedValue({
        filePath: 'server/routes/products.js',
        lines: ['const q = req.query.q;', 'db.query(`SELECT * FROM products WHERE name = ${q}`)'],
        offset: 40,
        truncated: false,
        byteLength: 100,
      } as SourceReadResult),
      readWholeFile: vi.fn(),
    };

    const deps = { sourceReader } as unknown as EngineerDependencies;
    const { source } = await readSource(deps, dummyContext, findingWithSource);

    expect(source).not.toBeNull();
    expect(source?.filePath).toBe('server/routes/products.js');
    expect(source?.lines).toHaveLength(2);
  });

  it('returns null source gracefully when filePath is missing', async () => {
    const sourceReader = {
      read: vi.fn(),
      readWholeFile: vi.fn(),
    };

    const deps = { sourceReader } as unknown as EngineerDependencies;
    const { source } = await readSource(deps, dummyContext, findingWithoutContext);

    expect(source).toBeNull();
    expect(sourceReader.read).not.toHaveBeenCalled();
  });

  it('prepares engineer run gracefully without sourcePath', async () => {
    const deps = {
      findings: {
        listConfirmed: vi.fn().mockResolvedValue([findingWithoutSource]),
        findByVulnerabilityId: vi.fn().mockResolvedValue(findingWithoutSource),
      },
      patches: {} as any,
      sourceReader: { read: vi.fn(), readWholeFile: vi.fn() } as any,
      rag: { search: vi.fn().mockResolvedValue({ documents: [] }) } as any,
      registry: {} as any,
      llm: {} as any,
      executions: {} as any,
      runtimeStore: {
        listByScan: vi.fn().mockResolvedValue([
          { status: 'READY', sandboxId: 'sb-1', containerId: 'c-1', imageName: 'img-1', targetUrl: 'http://172.23.0.2:3000', internalHost: '172.23.0.2', internalPort: 3000, exposedPort: 3000, createdAt: new Date().toISOString() },
        ]),
      } as any,
    } as EngineerDependencies;

    const prepared = await prepareEngineerRun(deps, { scanId: 'scan-1', vulnerabilityId: 'vuln-2' });

    expect(prepared.finding.vulnerabilityId).toBe('vuln-2');
    expect(prepared.source).toBeNull();
    expect(prepared.context).not.toBeNull();
  });
});
