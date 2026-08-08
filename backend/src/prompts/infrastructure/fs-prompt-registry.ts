/**
 * FileSystemPromptRegistry — reads prompt templates from
 * {root}/{version}/{scope}/{name}.md, caches file contents (bounded by the
 * tiny file count), and raises typed errors. Default root:
 * {repo}/backend/agents/prompts. Overridable for tests via PROMPTS_ROOT.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PROMPT_CATALOG, type PromptIdentifier, type PromptRegistry } from '../domain/prompt-registry';
import { PromptNotFoundError, PromptVersionError } from '../domain/prompt-errors';

export const DEFAULT_PROMPT_VERSION = 'v1';

export class FileSystemPromptRegistry implements PromptRegistry {
  private readonly root: string;
  private readonly cache = new Map<string, string>();

  constructor(root: string) {
    this.root = root;
  }

  async get(id: PromptIdentifier, version: string = DEFAULT_PROMPT_VERSION): Promise<string> {
    const entry = PROMPT_CATALOG[id];
    if (!entry) {
      throw new PromptNotFoundError(id, version);
    }
    const cacheKey = `${version}/${id}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const relative = entry.file;
    const fullPath = join(this.root, version, relative);
    const directory = join(this.root, version);
    try {
      await fs.access(directory);
    } catch {
      throw new PromptVersionError(version, `directory '${directory}' does not exist`);
    }
    let content: string;
    try {
      content = await fs.readFile(fullPath, 'utf-8');
    } catch {
      throw new PromptNotFoundError(id, version);
    }
    this.cache.set(cacheKey, content);
    return content;
  }
}

export function resolvePromptsRoot(explicit: string | undefined): string {
  if (explicit && explicit.trim().length > 0) return explicit;
  // Default: <repoRoot>/backend/agents/prompts. __dirname is
  // {backend}/{src|dist}/prompts/infrastructure at runtime — three levels up.
  return join(__dirname, '..', '..', '..', 'agents', 'prompts');
}