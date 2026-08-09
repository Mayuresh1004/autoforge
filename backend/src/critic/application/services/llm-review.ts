/**
 * Critical advisory LLM review (optional). Runs AFTER the deterministic
 * checks and EXPLICITLY NEVER overrides objective validation: a failing
 * retest stays REJECTED no matter what the model says; a passing retest can
 * only be downgraded by failing gates, never upgraded by an LLM.
 *
 * When no LLM provider is configured (or it errors), the advisory quietly
 * degrades to a deterministic verdict so the pipeline never blocks on an
 * optional step.
 */

import type { LLMProvider } from '../../../llm/domain/ports/llm-provider';
import type { PromptRegistry } from '../../../prompts/domain/prompt-registry';

export interface AdvisoryReviewInput {
  readonly vulnerabilitySummary: string;
  readonly filePath: string;
  readonly diff: string;
}

export interface AdvisoryReview {
  readonly available: boolean;
  readonly verdict: 'SAFE' | 'CONCERNED' | null;
  /** Bounded list of concerns (≤ 5, each ≤ 200 chars). */
  readonly concerns: readonly string[];
  readonly summary: string;
  readonly model: string | null;
}

export class CriticAdvisoryReviewer {
  constructor(
    private readonly llm: LLMProvider | null,
    private readonly registry: PromptRegistry,
  ) {}

  async review(input: AdvisoryReviewInput): Promise<AdvisoryReview> {
    if (!this.llm) {
      return { available: false, verdict: null, concerns: [], summary: '', model: null };
    }
    try {
      const [systemTemplate, reviewTemplate] = await Promise.all([
        this.registry.get('critic.system'),
        this.registry.get('critic.review'),
      ]);
      const system = fill(systemTemplate, {});
      const user = fill(reviewTemplate, {
        vulnerabilitySummary: input.vulnerabilitySummary.slice(0, 1_500),
        patchFile: input.filePath,
        patchDiff: input.diff.slice(0, 8_000),
      });
      const response = await this.llm.generate({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        maxTokens: 700,
        responseFormat: 'json_object',
      });
      const parsed = parseReviewObject(response.text);
      const verdict = parsed && (parsed.verdict === 'SAFE' || parsed.verdict === 'CONCERNED') ? parsed.verdict : null;
      return {
        available: true,
        verdict,
        concerns: boundedConcerns(parsed?.concerns),
        summary: String(parsed?.summary ?? '').slice(0, 300),
        model: response.model ?? null,
      };
    } catch {
      // Advisory only — never let an LLM outage fail the run.
      return { available: false, verdict: null, concerns: [], summary: '', model: null };
    }
  }
}


function boundedConcerns(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is string => typeof c === 'string')
    .slice(0, 5)
    .map((c) => c.slice(0, 200));
}

function parseReviewObject(text: string): { verdict?: string; concerns?: unknown; summary?: unknown } | null {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  if (!stripped.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    return {
      verdict: typeof parsed.verdict === 'string' ? parsed.verdict : undefined,
      concerns: parsed.concerns,
      summary: parsed.summary,
    };
  } catch {
    return null;
  }
}

function fill(template: string, vars: Readonly<Record<string, string>>): string {
  return Object.entries(vars).reduce(
    (out, [key, value]) => out.replaceAll(`{{${key}}}`, value),
    template,
  );
}