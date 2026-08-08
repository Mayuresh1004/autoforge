/**
 * Knowledge HTTP controller — transport only. Validates requests, delegates
 * to services, maps structured errors to HTTP:
 *  - ValidationError   → 400
 *  - KnowledgeNotFoundError → 404
 *  - KnowledgeSourceError / StoreUnavailable / Ingestion → 502/503
 */

import type { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewares/request.middleware';
import { ValidationError } from '../../../utils/errors';
import { createSuccessResponse } from '../../../utils/response';
import { KnowledgeNotFoundError } from '../../domain/errors/knowledge.errors';
import { RagValidationError } from '../../application/services/rag.service';
import type { CveIngestionService } from '../../application/services/cve-ingestion.service';
import type { RagService } from '../../application/services/rag.service';
import type { CveRepository } from '../../domain/ports/cve-repository';
import { IngestCveRequestSchema, RagSearchRequestSchema, toCveRecordResponse, toIngestSummaryResponse, toRagResponse } from '../dto/knowledge.dto';

export class KnowledgeController {
  constructor(private readonly deps: {
    readonly ingestion: CveIngestionService;
    readonly rag: RagService;
    readonly cveRepository: CveRepository;
  }) {}

  /** POST /knowledge/cve/ingest */
  ingestCve = asyncHandler(async (req: Request, res: Response) => {
    const parsed = IngestCveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid ingest request', parsed.error.flatten().fieldErrors);
    }
    const summary = await this.deps.ingestion.ingest({
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      maxItems: parsed.data.maxItems,
    });
    res.status(201).json(createSuccessResponse(toIngestSummaryResponse(summary)));
  });

  /** GET /knowledge/cve/:cveId */
  getCve = asyncHandler(async (req: Request, res: Response) => {
    const cveId = String(req.params.cveId);
    const record = await this.deps.cveRepository.findByCveId(cveId);
    if (!record) {
      throw new KnowledgeNotFoundError(cveId);
    }
    res.json(createSuccessResponse(toCveRecordResponse(record)));
  });

  /** POST /rag/search — internal, validated. */
  ragSearch = asyncHandler(async (req: Request, res: Response) => {
    const parsed = RagSearchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid RAG search request', parsed.error.flatten().fieldErrors);
    }
    try {
      const result = await this.deps.rag.search({
        query: parsed.data.query,
        topK: parsed.data.topK,
        filters: parsed.data.filters,
      });
      res.json(createSuccessResponse(toRagResponse(result)));
    } catch (error) {
      if (error instanceof RagValidationError) {
        throw new ValidationError(error.message);
      }
      throw error;
    }
  });
}