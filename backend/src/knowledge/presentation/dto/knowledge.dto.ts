/**
 * Knowledge API DTOs — zod-bounded request bodies + response mappers.
 * Bounds: maxItems capped, topK bounded by ragConfig, RAG filters restricted
 * to the whitelist of metadata fields (no free-form predicates).
 */

import { z } from 'zod';
import { ragConfig } from '../../../config';
import { RAG_QUERY_MAX_CHARS } from '../../application/services/rag.service';
import type { CveIngestionSummary } from '../../application/services/cve-ingestion.service';
import type { CveRecord } from '../../domain/ports/cve-repository';
import type { RagResult, RagResultDocument } from '../../application/services/rag.service';

const SEVERITY_VALUES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const IngestCveRequestSchema = z.object({
  source: z.enum(['nvd']).default('nvd'),
  /** ISO timestamp; fetch window (NVD lastModStartDate/EndDate style). */
  startTime: z.string().datetime({ offset: true }).optional(),
  endTime: z.string().datetime({ offset: true }).optional(),
  /** Hard bound on how many records one call may ingest. */
  maxItems: z.coerce.number().int().min(1).max(1_000).optional(),
});

export type IngestCveRequest = z.infer<typeof IngestCveRequestSchema>;

export const RagSearchRequestSchema = z.object({
  query: z.string().min(1).max(RAG_QUERY_MAX_CHARS),
  topK: z.coerce.number().int().min(1).max(ragConfig.topKMax).optional(),
  filters: z
    .object({
      sourceType: z.enum(['nvd']).optional(),
      cveId: z.string().regex(/^CVE-\d{4}-\d+$/i).optional(),
      vulnerabilityType: z.string().max(64).optional(),
      severity: z.enum(SEVERITY_VALUES).optional(),
      language: z.string().max(64).optional(),
      framework: z.string().max(64).optional(),
    })
    .optional(),
});

export type RagSearchRequest = z.infer<typeof RagSearchRequestSchema>;

export function toIngestSummaryResponse(summary: CveIngestionSummary) {
  return { ...summary };
}

export function toCveRecordResponse(record: CveRecord) {
  return {
    cveId: record.cveId,
    description: record.description,
    severity: record.severity,
    cvssScore: record.cvssScore,
    publishedAt: record.publishedAt,
    modifiedAt: record.modifiedAt,
  };
}

export function toRagResponse(result: RagResult) {
  return {
    query: result.query,
    documents: result.documents.map(toRagDocumentResponse),
  };
}

export function toRagDocumentResponse(document: RagResultDocument) {
  return {
    id: document.id,
    externalId: document.externalId,
    title: document.title,
    content: document.content,
    score: document.score,
    metadata: {
      sourceType: document.sourceType,
      vulnerabilityType: document.vulnerabilityType,
      severity: document.severity,
      language: document.language,
      framework: document.framework,
      sourceUrl: document.sourceUrl,
    },
  };
}