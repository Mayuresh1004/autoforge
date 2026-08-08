/**
 * Prompt registry — versioned, file-backed prompt templates under
 * agents/prompts/. The registry ONLY reads files: it never invokes an LLM,
 * never modifies prompts, and has zero provider dependencies.
 *
 * Identifier scheme: `{scope}.{name}` where the file is
 * agents/prompts/{version}/{scope}/{name}.md. Each template file may declare
 * front-matter placeholders ({{variableName}}); assembly happens in the
 * consuming agent layer, not here.
 */

export type PromptIdentifier =
  | 'engineer.system'
  | 'engineer.patch-generation'
  | 'engineer.rag-context'
  | 'engineer.security-review';

export interface PromptRegistry {
  /** Versioned lookup. Missing id → PromptNotFoundError; missing dir →
   *  PromptVersionError. */
  get(id: PromptIdentifier, version?: string): Promise<string>;
}

/** Every known prompt id with its canonical template position. */
export const PROMPT_CATALOG: Readonly<Record<PromptIdentifier, { file: string }>> = {
  'engineer.system': { file: 'engineer/system.md' },
  'engineer.patch-generation': { file: 'engineer/patch-generation.md' },
  'engineer.rag-context': { file: 'engineer/rag-context.md' },
  'engineer.security-review': { file: 'engineer/security-review.md' },
};