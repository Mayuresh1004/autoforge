/**
 * Opt-in LIVE Engineer E2E. Skipped by default — the default suite must pass
 * with no keys, no Docker, no live APIs.
 *
 *   ENGINEER_E2E=1   plus working LLM_* config (e.g. LLM_PRIMARY_PROVIDER
 *                    with GEMINI_API_KEY / OPENROUTER_API_KEY, or a fallback).
 *
 * Exercises the REAL LLMProvider built from config while findings, patches,
 * executions and the source reader stay in-memory. The gate skips (rather
 * than fails) when no live provider is configured. Never calls applyPatch.
 */

import { describe, expect, it } from 'vitest';
import { llmConfig, promptsConfig } from '../src/config';
import { createLLMProvider } from '../src/llm/infrastructure/factory/llm-provider-factory';
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
  StubEngineerSourceReader,
  StubRagService,
} from './helpers/engineer-fakes';

const ENABLED = process.env.ENGINEER_E2E === '1';

describe('engineer live provider (opt-in)', () => {
  it('runs one confirmed SQLi finding through the real LLM provider', async () => {
    if (!ENABLED) return;
    let llm: ReturnType<typeof createLLMProvider>;
    try {
      llm = createLLMProvider(llmConfig);
    } catch {
      return; // no live provider configured — skip, not fail
    }

    const findings = new MemoryConfirmedFindingRepository([confirmedFinding()]);
    const patches = new MemoryEngineerPatchRepository();
    const executions = new DefaultAgentExecutionService(new MemoryAgentExecutionRepository());
    const runtimeStore = new MemoryRuntimeSandboxStore();
    await runtimeStore.save({
      id: 'rt-live', scanId: 'scan-live', status: 'READY', name: 'app', repository: {},
      sandboxId: 'sandbox-live', imageId: null, imageName: null, networkId: null,
      targetUrl: 'http://127.0.0.1:33001', internalHost: '10.0.0.5', internalPort: 3000,
      exposedPort: 33001, workspacePath: null, createdAt: new Date().toISOString(),
      expiresAt: null, destroyedAt: null, failureStage: null, failureReason: null,
    });

    const engineer = new DefaultEngineerService({
      findings,
      patches,
      sourceReader: new StubEngineerSourceReader({
        'src/app.py': [
          'def lookup(name: str) -> list:',
          '    conn = get_conn()',
          '    cur = conn.execute(f"SELECT * FROM users WHERE name = {name}")',
          '    return cur.fetchall()',
        ].join('\n'),
      }),
      rag: new StubRagService([]),
      registry: new FileSystemPromptRegistry(resolvePromptsRoot(promptsConfig.root)),
      llm,
      executions,
      runtimeStore,
      bounds: DEFAULT_ENGINEER_BOUNDS,
      ragTopK: 4,
    });

    const result = await engineer.run({ scanId: 'scan-live' });
    expect(['GENERATED', 'REJECTED']).toContain(result.status);
    expect(result.summary.model).toBeTruthy();
    if (result.status === 'GENERATED') {
      const patch = patches.all()[0];
      expect(patch.status).toBe('GENERATED');
      expect(patch.diffContent).toContain('--- a/src/app.py');
      expect(result.summary.reviewPassed).toBe(true);
    }
  }, 120_000);
});