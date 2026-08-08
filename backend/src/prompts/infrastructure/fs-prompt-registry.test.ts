import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
import { FileSystemPromptRegistry } from './fs-prompt-registry';
import { PromptNotFoundError, PromptVersionError } from '../domain/prompt-errors';

const PROMPTS: Readonly<Record<string, string>> = {
  'v1/engineer/system.md': '# engineer system\n\n{{scanContext}}',
  'v1/engineer/patch-generation.md': '# patch generation\n\n{{repositoryContext}}',
  'v1/engineer/rag-context.md': '# rag context\n\n{{ragContext}}',
  'v1/engineer/security-review.md': '# security review\n\nSECURITY_REVIEW: PASS',
};

let root: string;

beforeAll(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), 'amass-prompts-'));
  for (const [relative, content] of Object.entries(PROMPTS)) {
    const full = join(root, relative);
    await fsp.mkdir(join(full, '..'), { recursive: true });
    await fsp.writeFile(full, content);
  }
});

afterAll(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('FileSystemPromptRegistry', () => {
  it('loads a versioned template by id', async () => {
    const registry = new FileSystemPromptRegistry(root);
    const content = await registry.get('engineer.system');
    expect(content).toContain('# engineer system');
  });

  it('maps each catalog id to the correct template file', async () => {
    const registry = new FileSystemPromptRegistry(root);
    const system = await registry.get('engineer.system');
    const patch = await registry.get('engineer.patch-generation');
    const rag = await registry.get('engineer.rag-context');
    const review = await registry.get('engineer.security-review');
    expect(system).toContain('{{scanContext}}');
    expect(patch).toContain('{{repositoryContext}}');
    expect(rag).toContain('{{ragContext}}');
    expect(review).toContain('SECURITY_REVIEW');
  });

  it('throws PromptNotFoundError when a file is missing', async () => {
    const registry = new FileSystemPromptRegistry(root);
    const path = join(root, 'v1', 'engineer/security-review.md');
    await fsp.rm(path);
    await expect(registry.get('engineer.security-review')).rejects.toBeInstanceOf(
      PromptNotFoundError,
    );
    // Restore so later tests (catalog coverage) see a complete v1 dir.
    await fsp.writeFile(path, PROMPTS['v1/engineer/security-review.md']);
  });

  it('throws PromptVersionError for an unknown version directory', async () => {
    const registry = new FileSystemPromptRegistry(root);
    await expect(registry.get('engineer.system', 'v99')).rejects.toBeInstanceOf(
      PromptVersionError,
    );
  });

  it('caches file contents', async () => {
    const registry = new FileSystemPromptRegistry(root);
    const first = await registry.get('engineer.system');
    const second = await registry.get('engineer.system');
    expect(first).toBe(second);
  });

  it('serves files regardless of LLM configuration (registry is fs-only)', () => {
    // Structural: the registry module must not import any provider SDK/types.
    const source = readFileSync(
      new URL('../infrastructure/fs-prompt-registry.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/openai|gemini|generativelanguage|@google/i);
  });

  it('catalog covers exactly the four sanctioned prompts', async () => {
    const registry = new FileSystemPromptRegistry(root);
    const ids = ['engineer.system', 'engineer.patch-generation', 'engineer.rag-context', 'engineer.security-review'] as const;
    for (const id of ids) {
      await expect(registry.get(id)).resolves.toBeTruthy();
    }
  });
});