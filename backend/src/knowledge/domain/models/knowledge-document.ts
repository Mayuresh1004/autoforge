/**
 * Normalized security-knowledge document — the single currency for RAG.
 * Sources (NVD today, GHSA/vendors/OWASP/docs later) normalize INTO this
 * shape; the vector store indexes id + embedding + a SMALL payload of useful
 * metadata (never arbitrary JSON, never huge raw documents).
 *
 * All knowledge is UNTRUSTED DATA: it is context for agents, never
 * instructions, and must never be executed or allowed to override system
 * prompts.
 */

export type KnowledgeSourceType = 'nvd' | 'amass-kb';

export type KnowledgeSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Rules for KnowledgeDocument.content — plain, bounded text. */
export const KNOWLEDGE_CONTENT_MAX_CHARS = 8_000;
export const KNOWLEDGE_TITLE_MAX_CHARS = 512;

export interface KnowledgeDocument {
  /** Stable point id, e.g. `cve:CVE-2024-1234`. */
  readonly id: string;
  readonly sourceType: KnowledgeSourceType;
  /** External identifier, e.g. the CVE id. */
  readonly externalId: string;
  readonly title: string;
  readonly content: string;
  /** Normalized vulnerability class (CWE top-level, e.g. "CWE-89"). */
  readonly vulnerabilityType: string | null;
  readonly severity: KnowledgeSeverity | null;
  readonly language: string | null;
  readonly framework: string | null;
  readonly sourceUrl: string | null;
  /** CVE-specific extras carried by ingestion (never raw provider JSON). */
  readonly metadata: KnowledgeDocumentMetadata;
}

export interface KnowledgeDocumentMetadata {
  /** CWE list (NVD weaknesses), e.g. ['CWE-79']. */
  readonly cwes: readonly string[];
  readonly cvssScore: number | null;
  readonly cvssVector: string | null;
  readonly publishedAt: string | null;
  readonly modifiedAt: string | null;
  /** Preserved reference URLs (NVD references[].url). */
  readonly references: readonly string[];
  /** Full plain-text description (needed by CVERecord persistence). */
  readonly description: string | null;
}