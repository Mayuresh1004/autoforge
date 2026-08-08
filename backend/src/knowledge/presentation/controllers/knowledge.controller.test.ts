import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ValidationError } from '../../../utils/errors';
import { KnowledgeController } from './knowledge.controller';
import { RagValidationError } from '../../application/services/rag.service';
import type { CveIngestionSummary } from '../../application/services/cve-ingestion.service';
import type { RagResult, RagService } from '../../application/services/rag.service';
import type { CveIngestionService } from '../../application/services/cve-ingestion.service';
import type { CveRepository } from '../../domain/ports/cve-repository';

function makeContext(overrides: {
  summary?: CveIngestionSummary;
  record?: unknown;
  ragResult?: RagResult;
  ragError?: Error;
} = {}) {
  const ingestion: CveIngestionService = {
    ingest: vi.fn(async () => overrides.summary ?? emptySummary()),
  } as unknown as CveIngestionService;

  const rag: RagService = {
    search: vi.fn(async (query: RagQueryInput) => {
      if (overrides.ragError) throw overrides.ragError;
      if (overrides.ragResult) return overrides.ragResult;
      return { query: query.query, documents: [] };
    }),
  } as unknown as RagService;

  const cveRepository: CveRepository = {
    findByCveId: vi.fn(async (cveId: string) => (overrides.record ?? null) as never),
    upsert: vi.fn(),
  } as unknown as CveRepository;

  const controller = new KnowledgeController({ ingestion, rag, cveRepository });
  return { controller, ingestion, rag, cveRepository };
}

function emptySummary(): CveIngestionSummary {
  return {
    source: 'nvd',
    requested: 0,
    fetched: 0,
    malformed: 0,
    inserted: 0,
    updated: 0,
    embedded: 0,
    skippedDuplicates: 0,
    hasMore: false,
  };
}

interface RagQueryInput {
  query: string;
  topK?: number;
  filters?: unknown;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    json: vi.fn((value: unknown) => {
      res.body = value;
      return res;
    }),
    status: vi.fn(function (this: unknown, code: number) {
      (this as { statusCode: number }).statusCode = code;
      return res;
    }),
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

function invoke(
  handler: (req: Request, res: Response, next: NextFunction) => void,
  req: Partial<Request>,
  res: ReturnType<typeof makeRes>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    handler(req as Request, res as unknown as Response, finish);
    // Success path never calls `next`. Settle on the macrotask boundary so
    // awaited chains (and their .catch(next)) run first; the settled flag
    // makes the second call a no-op.
    setTimeout(() => finish(), 0);
  });
}

describe('KnowledgeController', () => {
  it('POST ingest: validation error for a bad body', async () => {
    const { controller } = makeContext();
    const res = makeRes();
    await expect(
      invoke(controller.ingestCve, { body: { maxItems: 'not-a-number' } }, res),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('POST ingest: delegates and returns 201 + summary', async () => {
    const summary = { ...emptySummary(), fetched: 3, inserted: 3, embedded: 3 };
    const { controller } = makeContext({ summary });
    const res = makeRes();
    await invoke(controller.ingestCve, { body: { source: 'nvd', maxItems: 10 } }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ success: true, data: { fetched: 3, inserted: 3 } });
  });

  it('GET cve: 200 with serialized record', async () => {
    const { controller } = makeContext({
      record: {
        cveId: 'CVE-2024-0001',
        description: 'desc',
        severity: 'HIGH',
        cvssScore: 8.1,
        publishedAt: '2024-01-01T00:00:00.000Z',
        modifiedAt: null,
      },
    });
    const res = makeRes();
    await invoke(controller.getCve, { params: { cveId: 'CVE-2024-0001' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { cveId: 'CVE-2024-0001' } });
  });

  it('GET cve: 404 domain error when missing', async () => {
    const { controller } = makeContext();
    const res = makeRes();
    await expect(
      invoke(controller.getCve, { params: { cveId: 'CVE-9999-0000' } }, res),
    ).rejects.toMatchObject({ name: 'KnowledgeNotFoundError' });
  });

  it('RAG search: passes the validated body to the service', async () => {
    const { controller, rag } = makeContext();
    const res = makeRes();
    await invoke(
      controller.ragSearch,
      { body: { query: 'SQL injection flask', topK: 3, filters: { severity: 'HIGH' } } },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(rag.search).toHaveBeenCalledOnce();
    expect(res.body).toMatchObject({ success: true, data: { query: 'SQL injection flask' } });
  });

  it('RAG search: invalid body → ValidationError', async () => {
    const { controller } = makeContext();
    const res = makeRes();
    await expect(
      invoke(controller.ragSearch, { body: { query: '', topK: 100 } }, res),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('RAG search: maps a RagValidationError to ValidationError', async () => {
    const { controller } = makeContext({ ragError: new RagValidationError('topK too big') });
    const res = makeRes();
    await expect(
      invoke(controller.ragSearch, { body: { query: 'x' } }, res),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('RAG search: does not expose internal fields in the response', async () => {
    const { controller } = makeContext({
      ragResult: {
        query: 'q',
        documents: [
          {
            id: 'cve:CVE-2024-0001',
            externalId: 'CVE-2024-0001',
            title: 'CVE-2024-0001',
            content: 'full text',
            sourceType: 'nvd',
            vulnerabilityType: 'CWE-89',
            severity: 'HIGH',
            language: null,
            framework: null,
            sourceUrl: 'https://nvd.example',
            score: 0.87,
          },
        ],
      },
    });
    const res = makeRes();
    await invoke(controller.ragSearch, { body: { query: 'q' } }, res);
    const data = (res.body as { data: { documents: unknown[] } }).data;
    expect(data.documents[0]).not.toHaveProperty('vector');
    expect(data.documents[0]).not.toHaveProperty('payload');
    expect((data.documents[0] as { externalId: string }).externalId).toBe('CVE-2024-0001');
  });
});