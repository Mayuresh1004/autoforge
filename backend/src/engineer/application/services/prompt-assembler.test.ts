import { describe, expect, it } from 'vitest';
import { resolvePromptsRoot } from '../../../prompts/infrastructure/fs-prompt-registry';
import { FileSystemPromptRegistry } from '../../../prompts/infrastructure/fs-prompt-registry';
import { confirmedFinding, SQLI_PATCH_DIFF } from '../../../../test/helpers/engineer-fakes';
import { assembleEngineerRequest } from './prompt-assembler';

const ROOT = resolvePromptsRoot(process.env.PROMPTS_ROOT);

describe('prompt-assembler', () => {
  it('loads all four templates from the real registry (no hardcoded prompts)', async () => {
    const registry = new FileSystemPromptRegistry(ROOT);
    const assembly = await assembleEngineerRequest(registry, {
      finding: confirmedFinding(),
      repository: { name: 'demo-app', url: 'https://example.com/demo-app.git', primaryLanguage: 'python' },
      source: { filePath: 'src/app.py', lines: ['def search(q):', '    pass'], offset: 40, truncated: false, byteLength: 22 },
      ragAdvisory: '1. [CVE-2025-0001] (score 0.97)\nuse parameterized queries',
      ragDocsUsed: 1,
    });
    const all = assembly.messages.map((m) => m.content).join('\n');
    // the four sections must be present
    for (const expected of [
      '1. Task', '2. Confirmed vulnerability', '3. Repository', '4. Vulnerable file',
      '5. Relevant source context', '6. Static finding', '7. Runtime verification evidence',
      '8. RAG security knowledge', '9. Patch constraints', '10. Output schema',
    ]) {
      expect(all).toContain(expected);
    }
    expect(all).toContain('vuln-1');
    expect(all).toContain('src/app.py');
    expect(all).toContain('SQL_INJECTION');
    expect(all).toContain('CVE-2025-0001');
  });

  it('includes the rag-context warning and the untrusted-data stance', async () => {
    const registry = new FileSystemPromptRegistry(ROOT);
    const assembly = await assembleEngineerRequest(registry, {
      finding: confirmedFinding(),
      repository: { name: undefined, url: undefined, primaryLanguage: null },
      source: { filePath: 'src/app.py', lines: ['x'], offset: 1, truncated: false, byteLength: 1 },
      ragAdvisory: 'advisory doc',
      ragDocsUsed: 1,
    });
    const all = assembly.messages.map((m) => m.content).join('\n');
    expect(all.toLowerCase()).toContain('untrusted');
  });

  it('tells the model to refuse when context is insufficient and RAG is empty', async () => {
    const registry = new FileSystemPromptRegistry(ROOT);
    const assembly = await assembleEngineerRequest(registry, {
      finding: confirmedFinding({ message: null }),
      repository: { name: undefined, url: undefined, primaryLanguage: null },
      source: { filePath: 'src/app.py', lines: ['x'], offset: 1, truncated: false, byteLength: 1 },
      ragAdvisory: '',
      ragDocsUsed: 0,
    });
    const all = assembly.messages.map((m) => m.content).join('\n');
    expect(all).toContain('REJECTED');
    expect(all).toContain('No advisory knowledge documents were retrieved');
  });

  it('requests JSON-only output with the strict schema', async () => {
    const registry = new FileSystemPromptRegistry(ROOT);
    const assembly = await assembleEngineerRequest(registry, {
      finding: confirmedFinding(),
      repository: {},
      source: { filePath: 'src/app.py', lines: ['x'], offset: 1, truncated: false, byteLength: 1 },
      ragAdvisory: '',
      ragDocsUsed: 0,
    });
    const all = assembly.messages.map((m) => m.content).join('\n');
    expect(all).toContain('"status": "GENERATED" | "REJECTED"');
    expect(all).toContain('"vulnerabilityId"');
  });

  it('limits the source block to the requested window (bounded context)', async () => {
    const registry = new FileSystemPromptRegistry(ROOT);
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i + 1}`);
    const assembly = await assembleEngineerRequest(registry, {
      finding: confirmedFinding({ lineNumber: 200 }),
      repository: {},
      source: { filePath: 'src/app.py', lines: lines.slice(188, 212), offset: 189, truncated: false, byteLength: 400 },
      ragAdvisory: '',
      ragDocsUsed: 0,
    });
    const all = assembly.messages.map((m) => m.content).join('\n');
    expect(all).toContain('189–212');
    expect(all).not.toContain('line 300');
  });

  it('throws a typed error when a template is missing (registry failure)', async () => {
    const broken = {
      get: async () => { throw new Error('missing template'); },
    };
    await expect(
      assembleEngineerRequest(broken as never, {
        finding: confirmedFinding(),
        repository: {},
        source: { filePath: 'src/app.py', lines: ['x'], offset: 1, truncated: false, byteLength: 1 },
        ragAdvisory: '',
        ragDocsUsed: 0,
      }),
    ).rejects.toThrow('missing template');
  });
});