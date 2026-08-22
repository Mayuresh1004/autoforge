/**
 * Engineer run preparation — deterministic context assembly (application
 * layer). Moves selection / sandbox resolution / bounded source reading /
 * advisory RAG out of the orchestrator so each concern stays small and
 * individually testable. Everything flows through existing ports; no
 * Docker, no Qdrant, no provider SDKs here.
 */

import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';
import { toRuntimeContext } from '../../../sandbox/domain/entities/runtime-sandbox';
import type { RagResultDocument, RagService } from '../../../knowledge/application/services/rag.service';
import type { ConfirmedVulnerabilityFinding } from '../../domain/ports/confirmed-finding-repository';
import type { SourceReadResult } from '../../domain/ports/source-reader';
import {
  ConfirmedFindingNotFoundError,
  EngineerSourceError,
  UnsupportedVulnerabilityError,
} from '../../domain/errors/engineer.errors';
import { isSupportedConfirmedFinding, selectConfirmedVulnerability } from './engineer-selection';
import { resolveWindow } from './source-window';
import { buildRagQuery, ragDocumentsToAdvisory } from './rag-query-builder';
import { SourceResolver, type SourceResolutionResult } from './source-resolver';
import type { EngineerRunInput, EngineerDependencies } from './engineer.service';

export interface PreparedEngineerRun {
  readonly finding: ConfirmedVulnerabilityFinding;
  readonly context: RuntimeSandboxContext;
  readonly source: SourceReadResult | null;
  readonly resolution: SourceResolutionResult | null;
  readonly rag: {
    readonly docs: readonly RagResultDocument[];
    readonly advisory: string;
  };
}

/** Resolve the single finding this run remediates (deterministic). */
export async function resolveFinding(
  deps: Pick<EngineerDependencies, 'findings'>,
  input: EngineerRunInput,
): Promise<ConfirmedVulnerabilityFinding> {
  if (input.vulnerabilityId) {
    const found = await deps.findings.findByVulnerabilityId(input.scanId, input.vulnerabilityId);
    if (!found) {
      throw new ConfirmedFindingNotFoundError(`scan ${input.scanId} vulnerability ${input.vulnerabilityId}`);
    }
    if (!isSupportedConfirmedFinding(found)) {
      throw new UnsupportedVulnerabilityError(`(status=${found.status} type=${found.type})`);
    }
    return found;
  }
  const all = await deps.findings.listConfirmed(input.scanId);
  const selected = selectConfirmedVulnerability(all);
  if (!selected) {
    throw new ConfirmedFindingNotFoundError(`scan ${input.scanId} has no CONFIRMED supported vulnerability finding`);
  }
  return selected;
}

/** Resolve the READY runtime sandbox context for the scan (else null). */
export async function resolveSandboxContext(
  deps: Pick<EngineerDependencies, 'runtimeStore'>,
  scanId: string,
): Promise<RuntimeSandboxContext | null> {
  const sandboxes = await deps.runtimeStore.listByScan(scanId);
  const ready = sandboxes
    .filter((s) => s.status === 'READY' && s.sandboxId !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const top = ready[0];
  if (!top) return null;
  try {
    return toRuntimeContext(top);
  } catch {
    return null;
  }
}

/** Read the bounded source window for the finding via the source-reader port. */
export async function readSource(
  deps: Pick<EngineerDependencies, 'sourceReader' | 'maxSourceBytes' | 'maxContextLines' | 'defaultContextWindow'>,
  context: RuntimeSandboxContext,
  finding: ConfirmedVulnerabilityFinding,
  emit?: (event: import('../../../observability/domain/ports/event-bus').AmassEventInput) => void,
): Promise<{ source: SourceReadResult | null; resolution: SourceResolutionResult | null; resolvedFinding: ConfirmedVulnerabilityFinding }> {
  const resolver = new SourceResolver();
  const resolution = await resolver.resolve(finding, context, deps.sourceReader, undefined, undefined, emit);
  if (!resolution) {
    return { source: null, resolution: null, resolvedFinding: finding };
  }

  const targetPath = resolution.filePath;
  const resolvedFinding: ConfirmedVulnerabilityFinding = { ...finding, filePath: targetPath };

  try {
    const window = resolveWindow(finding.lineNumber, {
      window: deps.defaultContextWindow,
      maxLines: deps.maxContextLines,
    });
    const source = await deps.sourceReader.read(context, {
      path: targetPath,
      startLine: window.startLine,
      endLine: window.endLine,
      maxBytes: deps.maxSourceBytes,
    });
    return { source, resolution, resolvedFinding };
  } catch (err) {
    if (err instanceof EngineerSourceError) {
      return { source: null, resolution, resolvedFinding };
    }
    throw err;
  }
}

/** Retrieve RAG advisory knowledge; an outage is never fatal. */
export async function retrieveRag(
  deps: Pick<EngineerDependencies, 'rag' | 'ragTopK'>,
  finding: ConfirmedVulnerabilityFinding,
): Promise<{ docs: readonly RagResultDocument[]; advisory: string }> {
  try {
    const query = buildRagQuery(finding, { topK: deps.ragTopK ?? 4 });
    const result = await deps.rag.search(query);
    return { docs: result.documents, advisory: ragDocumentsToAdvisory(result.documents) };
  } catch {
    // RAG is advisory-only: a retrieval outage must never block remediation.
    return { docs: [], advisory: '' };
  }
}

/** Assemble every input a single run needs, or throw the typed error. */
export async function prepareEngineerRun(
  deps: EngineerDependencies,
  input: EngineerRunInput,
  emit?: (event: import('../../../observability/domain/ports/event-bus').AmassEventInput) => void,
): Promise<PreparedEngineerRun> {
  const initialFinding = await resolveFinding(deps, input);
  const context = await resolveSandboxContext(deps, initialFinding.scanId);
  if (!context) {
    throw new EngineerSourceError('SOURCE_UNAVAILABLE', 'no READY runtime sandbox for this scan');
  }
  const { source, resolution, resolvedFinding } = await readSource(deps, context, initialFinding, emit);
  const rag = await retrieveRag(deps, resolvedFinding);
  return { finding: resolvedFinding, context, source, resolution, rag };
}

/** Parse a JSON object from model text (tolerating code fences). */
export function tryParseJsonObject(text: string): unknown {
  const trimmed = text.trim();

  // 1. Try direct parse
  try {
    return JSON.parse(trimmed);
  } catch {}

  // 2. Strip code block fence markers from lines (```json ... ```)
  const stripped = trimmed
    .split('\n')
    .filter((line) => !/^\s*```(?:json)?\s*$/i.test(line))
    .join('\n')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {}

  // 3. Extract from first '{' to last '}'
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {}
  }

  return null;
}