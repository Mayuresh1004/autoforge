/**
 * Phase 7B acceptance — headless end-to-end of the Engineer agent:
 *
 *   confirmed SQLi finding → deterministic selection → bounded source
 *   → advisory RAG → v1/engineer prompts → (mocked) LLM → structural
 *   validation → security-review gate → GENERATED Patch persists.
 *
 * No network, no Docker, no live APIs: the LLM is a programmed stub and the
 * runtime-sandbox store is in-memory. Asserts the no-apply invariant.
 */

import { describe, expect, it } from 'vitest';
import { DefaultEngineerService } from '../src/engineer/application/services/engineer.service';
import { FileSystemPromptRegistry, resolvePromptsRoot } from '../src/prompts/infrastructure/fs-prompt-registry';
import { DefaultAgentExecutionService } from '../src/agent/application/services/agent-execution.service';
import { MemoryAgentExecutionRepository } from './helpers/memory-agent-execution-repository';
import { MemoryRuntimeSandboxStore } from './helpers/memory-runtime-sandbox-store';
import { DEFAULT_ENGINEER_BOUNDS } from '../src/engineer/domain/models/engineer-response';
import {
  confirmedFinding,
  MemoryConfirmedFindingRepository,
  MemoryEngineerPatchRepository,
  ProgrammedLLMProvider,
  StubEngineerSourceReader,
  StubRagService,
  SQLI_PATCH_JSON,
} from './helpers/engineer-fakes';

const PROMPT_REGISTRY = new FileSystemPromptRegistry(resolvePromptsRoot(process.env.PROMPTS_ROOT));

describe('phase 7B engineer acceptance', () => {
  it('produces a GENERATED patch from a confirmed SQLi, never applying it', async () => {
    const findings = new MemoryConfirmedFindingRepository([confirmedFinding()]);
    const patches = new MemoryEngineerPatchRepository();
    const sourceReader = new StubEngineerSourceReader({
      'src/app.py': [
        'def user_profile(query):',
        '  name = request.args["name"]',
        '  conn = get_conn()',
        '  cur = conn.execute(f"SELECT * FROM accounts WHERE name = {name}")',
        '  return cur.fetchall()',
      ].join('\n'),
    });
    const rag = new StubRagService([]);
    const llm = new ProgrammedLLMProvider('fake/free');
    llm.setText(SQLI_PATCH_JSON);

    const executions = new DefaultAgentExecutionService(new MemoryAgentExecutionRepository());
    const runtimeStore = new MemoryRuntimeSandboxStore();
    await runtimeStore.save({
      id: 'rt-1', scanId: 'scan-1', status: 'READY', name: 'app', repository: {},
      sandboxId: 'sandbox-1', imageId: null, imageName: null, networkId: null,
      targetUrl: 'http://127.0.0.1:33001', internalHost: '10.0.0.5', internalPort: 3000,
      exposedPort: 33001, workspacePath: null, createdAt: new Date().toISOString(),
      expiresAt: null, destroyedAt: null, failureStage: null, failureReason: null,
    });

    const engineer = new DefaultEngineerService({
      findings,
      patches,
      sourceReader,
      rag,
      registry: PROMPT_REGISTRY,
      llm,
      executions,
      runtimeStore,
      bounds: DEFAULT_ENGINEER_BOUNDS,
      ragTopK: 4,
    });

    const result = await engineer.run({ scanId: 'scan-1' });

    expect(result.status).toBe('GENERATED');
    expect(result.vulnerabilityId).toBe('vuln-1');
    expect(result.patchId).toBeTruthy();
    expect(result.summary.reviewPassed).toBe(true);
    expect(result.summary.model).toBe('fake/free');
    expect(result.summary.ragDocs).toBe(0);

    const patch = patches.all()[0];
    expect(patch.status).toBe('GENERATED');
    expect(patch.vulnerabilityId).toBe('vuln-1');
    expect(patch.filePath).toBe('src/app.py');
    expect(patch.diffContent).toContain('--- a/src/app.py');
    expect(patch.diffContent).toContain('+');
    expect(patch.explanation.length).toBeGreaterThan(0);

    // invariant: only GENERATED/REJECTED rows may ever exist
    for (const row of patches.all()) {
      expect(['GENERATED', 'REJECTED']).toContain(row.status);
    }

    const detail = await engineer.getRun(result.executionId);
    expect(detail?.agentType).toBe('ENGINEER');
    expect(detail?.status).toBe('COMPLETED');
    const persistedJson = JSON.stringify(detail);
    expect(persistedJson).not.toContain('AIza');
    expect(persistedJson).not.toContain('sk-');
  });
});