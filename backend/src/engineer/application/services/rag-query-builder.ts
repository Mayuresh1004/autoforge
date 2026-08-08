/**
 * RAG query construction for the Engineer — pure, testable, and RAG-limited
 * to the whitelisted knowledge metadata. The Engineer NEVER talks to Qdrant
 * or embedders: it builds a query + filters and hands it to the existing
 * RagService port.
 *
 * Query shape (advisory knowledge only):
 *   "<language> sql injection remediation <CWE/finding message> in <file>"
 * Filters: vulnerabilityType=SQL_INJECTION — plus severity when known.
 */

import type { RagFilters, RagQuery, RagResultDocument } from '../../../knowledge/application/services/rag.service';
import type { ConfirmedVulnerabilityFinding } from '../../domain/ports/confirmed-finding-repository';

const LANGUAGE_FROM_EXT: Readonly<Record<string, string>> = {
  py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  java: 'java', go: 'go', rb: 'ruby', php: 'php', cs: 'csharp', cpp: 'cpp', c: 'c',
  sql: 'sql', kt: 'kotlin', swift: 'swift', scala: 'scala', rs: 'rust', vue: 'javascript',
  svelte: 'javascript', sh: 'shell', bash: 'shell', gradle: 'gradle', properties: 'properties',
};

export function languageFromPath(filePath: string | null): string | null {
  if (!filePath) return null;
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return null;
  return LANGUAGE_FROM_EXT[filePath.slice(dot + 1).toLowerCase()] ?? null;
}

const KNOWLEDGE_SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);

/** Build the focused RAG query for a confirmed finding. */
export function buildRagQuery(
  finding: ConfirmedVulnerabilityFinding,
  options?: { readonly topK?: number },
): RagQuery {
  const language = languageFromPath(finding.filePath);
  const hintParts = [language, 'sql injection', 'remediation'].filter(Boolean);
  const subject = (finding.message ?? '').slice(0, 300);
  const file = finding.filePath ?? '';

  const parts = [...hintParts, subject, file ? `in ${file}` : ''].filter(Boolean);

  const filters: RagFilters = KNOWLEDGE_SEVERITIES.has(finding.severity)
    ? { vulnerabilityType: 'SQL_INJECTION', severity: finding.severity as RagFilters['severity'] }
    : { vulnerabilityType: 'SQL_INJECTION' };

  return {
    query: parts.join(' ').slice(0, 1_000) || 'sql injection remediation',
    topK: options?.topK ?? 4,
    filters,
  };
}

/**
 * Render retrieved documents into the advisory block that goes into the
 * prompt. Only title / content / score / source metadata — never raw
 * payloads — and content is truncated. Retrieved text stays UNTRUSTED
 * (the rag-context template marks it advisory, never instructional).
 */
export function ragDocumentsToAdvisory(
  documents: readonly RagResultDocument[],
  maxTitleChars = 140,
  maxContentChars = 1_200,
): string {
  const maxDocs = 8;
  const parts = documents.slice(0, maxDocs).map((doc, index) => {
    const title = (doc.title ?? doc.externalId).slice(0, maxTitleChars);
    const body = (doc.content ?? '').slice(0, maxContentChars);
    const meta = [doc.sourceUrl, doc.sourceType ?? 'nvd'].filter(Boolean).join(' — ');
    return `${index + 1}. [${title}] (score ${doc.score.toFixed(3)} — ${meta})\n${body}`;
  });
  return parts.join('\n---\n');
}