import { describe, expect, it, vi } from 'vitest';
import { DefaultEngineerService } from './engineer.service';
import type { EngineerService } from './engineer.service';
import { MemoryAgentExecutionRepository } from '../../../../test/helpers/memory-agent-execution-repository';
import { DefaultAgentExecutionService } from '../../../agent/application/services/agent-execution.service';
import { MemoryRuntimeSandboxStore } from '../../../../test/helpers/memory-runtime-sandbox-store';
import { FileSystemPromptRegistry } from '../../../prompts/infrastructure/fs-prompt-registry';
import { resolvePromptsRoot } from '../../../prompts/infrastructure/fs-prompt-registry';
import {
  confirmedFinding,
  MemoryConfirmedFindingRepository,
  MemoryEngineerPatchRepository,
  StubEngineerSourceReader,
  ProgrammedLLMProvider as StubLLMProvider,
  StubRagService,
  SQLI_PATCH_JSON,
} from '../../../../test/helpers/engineer-fakes';
import {
  ConfirmedFindingNotFoundError,
  InvalidEngineerResponseError,
  UnsupportedVulnerabilityError,
} from '../../domain/errors/engineer.errors';
import { DEFAULT_ENGINEER_BOUNDS } from '../../domain/models/engineer-response';
import type { ConfirmedVulnerabilityFinding } from '../../domain/ports/confirmed-finding-repository';

const PROMPT_REGISTRY = new FileSystemPromptRegistry(resolvePromptsRoot(process.env.PROMPTS_ROOT));

function buildEngineer(overrides: {
  findings?: readonly ConfirmedVulnerabilityFinding[];
  llmError?: Error;
  ragError?: string;
  noSandbox?: boolean;
  files?: Record<string, string>;
} = {}): {
  engineer: EngineerService;
  patches: MemoryEngineerPatchRepository;
  llm: StubLLMProvider;
  executions: DefaultAgentExecutionService;
  executionRows: MemoryAgentExecutionRepository;
} {
  const findingsRepository = new MemoryConfirmedFindingRepository(
    overrides.findings ?? [confirmedFinding()],
  );
  const patchesRepository = new MemoryEngineerPatchRepository();
  const sourceReader = new StubEngineerSourceReader(overrides.files ?? {
    'src/app.py': ['def expensive_search(query):', '  conn = get_conn()', '  stmt = f"SELECT * FROM users WHERE name = {q}"', '  return conn.execute(stmt)'].join('\n'),
  });
  const rag = new StubRagService([]);
  if (overrides.ragError) rag.failNext(new Error(overrides.ragError));
  const llm = new StubLLMProvider('fake/free');
  if (overrides.llmError) llm.failNext(overrides.llmError);
  llm.setText(SQLI_PATCH_JSON);

  const executionRows = new MemoryAgentExecutionRepository();
  const executions = new DefaultAgentExecutionService(executionRows);
  const runtimeStore = new MemoryRuntimeSandboxStore();
  if (!overrides.noSandbox) {
    void runtimeStore.save({
      id: 'rt-1', scanId: 'scan-1', status: 'READY', name: 'app', repository: {},
      sandboxId: 'sandbox-1', imageId: null, imageName: null, networkId: null,
      targetUrl: 'http://127.0.0.1:33001', internalHost: '10.0.0.5', internalPort: 3000,
      exposedPort: 33001, workspacePath: null, createdAt: new Date().toISOString(),
      expiresAt: null, destroyedAt: null, failureStage: null, failureReason: null,
    });
  }

  const engineer: EngineerService = new DefaultEngineerService({
    findings: findingsRepository,
    patches: patchesRepository,
    sourceReader,
    rag,
    registry: PROMPT_REGISTRY,
    llm,
    executions,
    runtimeStore,
    bounds: DEFAULT_ENGINEER_BOUNDS,
    ragTopK: 4,
  });

  return { engineer, patches: patchesRepository, llm, executions, executionRows };
}

const ENGINEER_TEST_SOURCE = 'src/app.py';

describe('engineer.service', () => {
  it('runs the full pipeline and persists GENERATED without applying anything', async () => {
    const deps = buildEngineer();
    const result = await deps.engineer.run({ scanId: 'scan-1' });

    expect(result.status).toBe('GENERATED');
    expect(result.patchId).toBeTruthy();
    expect(result.vulnerabilityId).toBe('vuln-1');
    expect(result.summary.reviewPassed).toBe(true);
    expect(result.summary.model).toBe('fake/free');

    const patch = deps.patches.all()[0];
    expect(patch.status).toBe('GENERATED');
    expect(patch.filePath).toBe('src/app.py');
    expect(patch.diffContent).toContain('--- a/src/app.py');
    expect(patch.diffContent).toContain('@@');
    expect(patch.explanation.length).toBeGreaterThan(0);

    // LLM was invoked once with json_object + a bounded token cap
    expect(deps.llm.requests).toHaveLength(1);
    const recorded = deps.llm.requests[0];
    expect(typeof recorded.maxTokens).toBe('number');

    // AgentExecution COMPLETED
    const rows = deps.executionRows.all();
    const record = rows[rows.length - 1];
    expect(record.status).toBe('COMPLETED');
    expect(record.agentType).toBe('ENGINEER');
  });

  it('only ever writes GENERATED patches (no apply/approve states)', async () => {
    const deps = buildEngineer();
    await deps.engineer.run({ scanId: 'scan-1' });
    for (const patch of deps.patches.all()) {
      expect(['GENERATED', 'REJECTED']).toContain(patch.status);
    }
  });

  it('selects deterministically when no vulnerabilityId is given', async () => {
    const deps = buildEngineer({
      findings: [
        confirmedFinding({ vulnerabilityId: 'a', severity: 'MEDIUM' }),
        confirmedFinding({ vulnerabilityId: 'hi', severity: 'HIGH' }),
      ],
    });
    // the programmed LLM must answer for the SELECTED finding id
    const patchFor = (id: string) =>
      JSON.stringify({ ...(JSON.parse(SQLI_PATCH_JSON) as Record<string, unknown>), vulnerabilityId: id });
    deps.llm.setText(patchFor('hi'));
    expect((await deps.engineer.run({ scanId: 'scan-1' })).vulnerabilityId).toBe('hi');
    deps.llm.setText(patchFor('hi'));
    expect((await deps.engineer.run({ scanId: 'scan-1' })).vulnerabilityId).toBe('hi');
  });

  it('errors when the targeted finding is not a supported CONFIRMED SQLi', async () => {
    const deps = buildEngineer({
      findings: [confirmedFinding({ vulnerabilityId: 'x', status: 'NOT_CONFIRMED' as never })],
    });
    await expect(
      deps.engineer.run({ scanId: 'scan-1', vulnerabilityId: 'x' }),
    ).rejects.toBeInstanceOf(UnsupportedVulnerabilityError);
    const rows = deps.executionRows.all();
    expect(rows.some((r) => r.status === 'FAILED')).toBe(true);
  });

  it('errors when nothing CONFIRMED+SQLi exists for the scan', async () => {
    const deps = buildEngineer({ findings: [] });
    await expect(deps.engineer.run({ scanId: 'scan-1' })).rejects.toBeInstanceOf(ConfirmedFindingNotFoundError);
  });

  it('fails cleanly when there is no READY runtime sandbox for the scan', async () => {
    const deps = buildEngineer({ noSandbox: true });
    await expect(deps.engineer.run({ scanId: 'scan-1' })).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    const rows = deps.executionRows.all();
    expect(rows[rows.length - 1].status).toBe('FAILED');
  });

  it('continues when RAG is unavailable (advisory only)', async () => {
    const deps = buildEngineer({ ragError: 'embedding outage' });
    const result = await deps.engineer.run({ scanId: 'scan-1' });
    expect(result.status).toBe('GENERATED');
    expect(result.summary.ragDocs).toBe(0);
    const record = deps.executionRows.all().at(-1);
    expect(record.status).toBe('COMPLETED');
  });

  it('refuses MALFORMED LLM output and persists nothing', async () => {
    const deps = buildEngineer();
    deps.llm.setText('this is definitely not json');
    await expect(deps.engineer.run({ scanId: 'scan-1' })).rejects.toBeInstanceOf(InvalidEngineerResponseError);
    expect(deps.patches.all()).toHaveLength(0);
  });

  it('refuses output with the wrong vulnerabilityId', async () => {
    const deps = buildEngineer();
    const wrong = JSON.parse(SQLI_PATCH_JSON) as Record<string, unknown>;
    wrong.vulnerabilityId = 'some-other-vuln';
    deps.llm.setText(JSON.stringify(wrong));
    await expect(deps.engineer.run({ scanId: 'scan-1' })).rejects.toBeInstanceOf(InvalidEngineerResponseError);
    expect(deps.patches.all()).toHaveLength(0);
  });

  it('persists a REJECTED patch with a reason when the model refuses', async () => {
    const deps = buildEngineer();
    deps.llm.setText(JSON.stringify({
      vulnerabilityId: 'vuln-1', status: 'REJECTED', filePath: null, diff: null,
      explanation: 'insufficient context to see the query builder',
      remediation: 'parameterized query', assumptions: [], reason: 'cannot locate the cursor.execute site',
    }));
    const result = await deps.engineer.run({ scanId: 'scan-1' });
    expect(result.status).toBe('REJECTED');
    const patch = deps.patches.all()[0];
    expect(patch.status).toBe('REJECTED');
    expect(patch.diffContent).toBeNull();
  });

  it('never persists secrets into AgentExecution metadata', async () => {
    const deps = buildEngineer();
    await deps.engineer.run({ scanId: 'scan-1' });
    const rows = deps.executionRows.all();
    const json = JSON.stringify(rows);
    expect(json).not.toContain('sk-');
    expect(json).not.toContain('AIza');
  });

  it('records FAILED executions with bounded errorMessage', async () => {
    const deps = buildEngineer();
    deps.llm.failNext(new Error('provider down'));
    await expect(deps.engineer.run({ scanId: 'scan-1' })).rejects.toThrow('provider down');
    const rows = deps.executionRows.all();
    const last = rows[rows.length - 1];
    expect(last.status).toBe('FAILED');
    const persisted = (last as unknown as { __persisted?: { errorMessage?: string } }).__persisted;
    expect((persisted?.errorMessage ?? '').length).toBeLessThanOrEqual(2_000);
  });

  it('getRun returns the ENGINEER execution detail', async () => {
    const deps = buildEngineer();
    const result = await deps.engineer.run({ scanId: 'scan-1' });
    const detail = await deps.engineer.getRun(result.executionId);
    expect(detail?.agentType).toBe('ENGINEER');
    expect(detail?.outputMetadata).toBeDefined();
    expect(detail?.status).toBe('COMPLETED');
  });

  it('handles dynamic confirmed finding with no matching source by returning REJECTED status without calling LLM', async () => {
    const dynamicFinding = confirmedFinding({
      vulnerabilityId: 'dyn-vuln-1',
      filePath: null,
      lineNumber: null,
      endpoint: 'http://172.23.0.2:3000/api/nonexistent?id=',
      method: 'GET',
      parameter: 'id',
    });
    const deps = buildEngineer({ findings: [dynamicFinding] });
    const llmSpy = vi.spyOn(deps.llm, 'generate');
    const result = await deps.engineer.run({ scanId: 'scan-1', vulnerabilityId: 'dyn-vuln-1' });
    expect(result.status).toBe('REJECTED');
    expect(result.summary.sourceLines).toBe(0);
    expect(llmSpy).not.toHaveBeenCalled();
    const patch = deps.patches.all()[0];
    expect(patch.status).toBe('REJECTED');
    expect(patch.diffContent).toBeNull();
  });

  it('remediates dynamic confirmed SQL injection finding by resolving target file dynamically', async () => {
    const dynamicFinding = confirmedFinding({
      vulnerabilityId: 'dyn-sql-1',
      filePath: null,
      lineNumber: null,
      endpoint: 'http://172.23.0.2:3000/api/products/search?q=',
      method: 'GET',
      parameter: 'q',
    });
    const files = {
      'src/routes/products.ts': `router.get('/api/products/search', (req, res) => { const q = req.query.q; db.query("SELECT * FROM products WHERE name = '" + q + "'"); });`,
    };
    const deps = buildEngineer({ findings: [dynamicFinding], files });
    deps.llm.setText(JSON.stringify({
      vulnerabilityId: 'dyn-sql-1',
      status: 'GENERATED',
      filePath: 'src/routes/products.ts',
      originalCode: 'db.query("SELECT * FROM products WHERE name = \'" + q + "\'");',
      patchedCode: 'db.query("SELECT * FROM products WHERE name = ?", [q]);',
      explanation: 'Parameterized query search',
      remediation: 'parameterized query',
      assumptions: [],
    }));

    const result = await deps.engineer.run({ scanId: 'scan-1', vulnerabilityId: 'dyn-sql-1' });
    expect(result.status).toBe('GENERATED');
    expect(result.patchId).toBeTruthy();
    const patch = deps.patches.all()[0];
    expect(patch.status).toBe('GENERATED');
    expect(patch.filePath).toBe('src/routes/products.ts');
    expect(patch.diffContent).toContain('--- a/src/routes/products.ts');
    expect(patch.diffContent).toContain('+db.query("SELECT * FROM products WHERE name = ?", [q]);');
  });
});

// ---- tiny imports alias (helpers live under test/helpers) -----------------