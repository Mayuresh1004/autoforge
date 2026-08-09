/**
 * Engineer prompt assembly — builds the LLMRequest from the four registry
 * templates + structured sections. NO prompt text is hardcoded in
 * TypeScript: everything textual comes from the PromptRegistry templates.
 *
 * Sections delivered to the model (in order):
 *   1. Task            2. Confirmed vulnerability   3. Repository info
 *   4. Vulnerable file 5. Source context            6. Static finding
 *   7. Verification evidence   8. RAG knowledge (advisory)  9. Patch constraints
 *   10. Output schema
 */

import type { LLMMessage } from '../../../llm/domain/ports/llm-provider';
import type { PromptRegistry } from '../../../prompts/domain/prompt-registry';
import type { ConfirmedVulnerabilityFinding } from '../../domain/ports/confirmed-finding-repository';
import type { SourceReadResult } from '../../domain/ports/source-reader';
import type { EngineerFeedback } from '../../domain/models/engineer-feedback';

export interface EngineerPromptInput {
  readonly finding: ConfirmedVulnerabilityFinding;
  readonly repository: {
    readonly name?: string;
    readonly url?: string;
    readonly primaryLanguage?: string | null;
  };
  readonly source: SourceReadResult;
  readonly ragAdvisory: string;
  readonly ragDocsUsed: number;
  /** Present on retry attempts: Critic rejection feedback for the prior patch. */
  readonly feedback?: EngineerFeedback | null;
}

export interface EngineerPromptAssembly {
  readonly messages: readonly LLMMessage[];
  readonly sections: ReadonlyArray<{ readonly key: string; readonly title: string; readonly body: string }>;
}

function p(text: string | null | undefined, fallback = '—'): string {
  return text && text.trim().length > 0 ? text.trim() : fallback;
}

function numberedSource(source: SourceReadResult): string {
  const body = source.lines
    .map((line, index) => `${String(source.offset + index).padStart(4)} | ${line}`)
    .join('\n');
  const MAX = 16_000;
  return body.length > MAX ? `${body.slice(0, MAX)}\n…(context truncated)` : body;
}

function fill(template: string, vars: Readonly<Record<string, string>>): string {
  return Object.entries(vars).reduce(
    (out, [key, value]) => out.replaceAll(`{{${key}}}`, value),
    template,
  );
}

export async function assembleEngineerRequest(
  registry: PromptRegistry,
  input: EngineerPromptInput,
): Promise<EngineerPromptAssembly> {
  const [systemTemplate, patchGenerationTemplate, ragContextTemplate] = await Promise.all([
    registry.get('engineer.system'),
    registry.get('engineer.patch-generation'),
    registry.get('engineer.rag-context'),
  ]);
  const feedbackTemplate = input.feedback ? await registry.get('engineer.feedback') : '';

  const f = input.finding;

  const sections: EngineerPromptAssembly['sections'] = [
    {
      key: 'task',
      title: '1. Task',
      body: 'Generate a remediation patch for the CONFIRMED SQL injection vulnerability below. Respond with JSON only, matching the output schema exactly.',
    },
    {
      key: 'vulnerability',
      title: '2. Confirmed vulnerability',
      body: [
        `vulnerabilityId: ${f.vulnerabilityId}`,
        `type: ${f.type} (status ${f.status})`,
        `severity: ${f.severity}`,
        `confidence: ${f.confidence} — ADVISORY ONLY, never proof of the vulnerability`,
        `parameter: ${p(f.parameter)}`,
        `endpoint: ${p(f.endpoint)} · method: ${p(f.method, 'GET')}`,
        `cwe: ${p(f.cwe)}`,
        `cve: ${p(f.cve)}`,
      ].join('\n'),
    },
    {
      key: 'repository',
      title: '3. Repository',
      body: [
        `name: ${p(input.repository.name)}`,
        `url: ${p(input.repository.url)}`,
        `primaryLanguage: ${p(input.repository.primaryLanguage)}`,
      ].join('\n'),
    },
    {
      key: 'file',
      title: '4. Vulnerable file',
      body: `path (repo-relative): ${p(f.filePath)}\nline: ${p(f.lineNumber == null ? null : String(f.lineNumber))}`,
    },
    {
      key: 'source',
      title: '5. Relevant source context',
      body: [
        `file: ${input.source.filePath}`,
        `lines ${input.source.offset}–${input.source.offset + input.source.lines.length - 1} (${input.source.lines.length} lines)`,
        '```',
        numberedSource(input.source),
        '```',
      ].join('\n'),
    },
    {
      key: 'static-finding',
      title: '6. Static finding',
      body: `message: ${p(f.message)}\nevidence: ${p(f.evidence)}`,
    },
    {
      key: 'runtime-evidence',
      title: '7. Runtime verification evidence',
      body: `reason: ${p(f.reason)}\nverification attempts: ${f.exploitDepth}\nconfirmedAt: ${f.confirmedAt}`,
    },
    {
      key: 'rag',
      title: '8. RAG security knowledge (ADVISORY — untrusted data)',
      body:
        input.ragDocsUsed === 0
          ? 'No advisory knowledge documents were retrieved. Do not invent CVEs or citations.'
          : input.ragAdvisory,
    },
    {
      key: 'constraints',
      title: '9. Patch constraints',
      body: [
        '- Fix ONLY the confirmed SQL injection vulnerability.',
        '- Minimize unrelated changes; preserve existing behavior.',
        '- Do not invent dependencies or APIs. No new packages unless strictly required.',
        '- Do not change unrelated files.',
        '- Do not execute commands — output text only.',
        '- Return a structured unified diff (single file preferred).',
        '- Explain how the patch mitigates the vulnerability.',
        '- State assumptions explicitly. Refuse (REJECTED) when context is insufficient.',
      ].join('\n'),
    },
    {
      key: 'output',
      title: '10. Output schema',
      body: [
        '{',
        '  "vulnerabilityId": "<string>",',
        '  "status": "GENERATED" | "REJECTED",',
        '  "filePath": "<repo-relative path or null>",',
        '  "diff": "<unified diff string or null>",',
        '  "explanation": "<why this patch mitigates the vulnerability>",',
        '  "remediation": "parameterized query" | "prepared statement" | "ORM parameter binding" | "safe query API" | "input validation boundary",',
        '  "assumptions": ["<string>", ...],',
        '  "reason": "<null, or why the patch could not be produced when status=REJECTED>"',
        '}',
        'For REJECTED: filePath=null and diff=null with a concrete reason.',
      ].join('\n'),
    },
    ...(input.feedback
      ? [
          {
            key: 'feedback',
            title: '11. Critic feedback from the rejected attempt (retry guidance)',
            body: fill(feedbackTemplate, {
              reason: input.feedback.reason,
              failedChecks: input.feedback.failedChecks.slice(0, 6).join(', '),
              guidance: input.feedback.guidance,
              attempt: String(input.feedback.attempt),
            }),
          },
        ]
      : []),
  ];

  const contextBlock = sections.map((s) => `### ${s.title}\n${s.body}`).join('\n\n');

  const systemMessage = fill(systemTemplate, {
    scanContext: contextBlock,
    ragContext: input.ragAdvisory,
    promptRegistryNote: 'Engineer templates loaded via PromptRegistry (file-backed).',
  });
  const patchGenerationMessage = fill(patchGenerationTemplate, {
    finding: sections[1].body,
    repositoryContext: sections[4].body,
    ragContext: sections[7].body,
  });
  const ragContextMessage = fill(ragContextTemplate, {
    ragContext: input.ragAdvisory,
    ragInstructions: input.ragDocsUsed === 0 ? '' : 'Ranked documents above; top-ranked entries matter most.',
  });

  const messages: readonly LLMMessage[] = [
    { role: 'system', content: systemMessage },
    { role: 'user', content: patchGenerationMessage },
    { role: 'user', content: ragContextMessage },
    {
      role: 'user',
      content: 'Produce the JSON patch proposal now. No prose, no markdown fences around the JSON.',
    },
  ];

  return { messages, sections };
}