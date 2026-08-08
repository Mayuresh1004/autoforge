/**
 * Knowledge infrastructure factory — wires the NVD source, Qdrant store,
 * CVE repository, embedding provider, and RAG service. Lazy: nothing touches
 * the network until a service is actually called. Application code consumes
 * the ports; this file is the only place concrete adapters are assembled.
 */

import type { PrismaClient } from '@prisma/client';
import type { EmbeddingProvider } from '../../../embedding/domain/ports/embedding-provider';
import { createEmbeddingProvider } from '../../../embedding/infrastructure/factory/embedding-provider-factory';
import type { EmbeddingConfig } from '../../../embedding/domain/ports/embedding-provider';
import type { CveIngestionService } from '../../application/services/cve-ingestion.service';
import { DefaultCveIngestionService } from '../../application/services/cve-ingestion.service';
import type { RagService } from '../../application/services/rag.service';
import { RagService as DefaultRagService } from '../../application/services/rag.service';
import type { CveRepository } from '../../domain/ports/cve-repository';
import { NvdKnowledgeSource, type NvdSourceOptions } from '../sources/nvd-knowledge-source';
import { PrismaCveRepository } from '../persistence/prisma-cve-repository';
import { QdrantClient } from '../qdrant/qdrant-client';
import { QdrantKnowledgeStore } from '../store/qdrant-knowledge-store';

export interface KnowledgeConfig {
  readonly embedding: EmbeddingConfig;
  readonly nvd: NvdSourceOptions;
  readonly qdrant: {
    readonly baseUrl: string;
    readonly apiKey?: string;
    readonly timeoutMs: number;
    readonly collection: string;
  };
}

export interface KnowledgeInfrastructure {
  readonly cveRepository: CveRepository;
  readonly embeddingProvider: EmbeddingProvider;
  readonly ingestion: CveIngestionService;
  readonly rag: RagService;
  /** Ensure the Qdrant collection exists (idempotent; may touch network). */
  ensureVectorCollection(): Promise<void>;
}

export function createKnowledgeInfrastructure(
  config: KnowledgeConfig,
  prisma: PrismaClient,
): KnowledgeInfrastructure {
  const embeddingProvider = createEmbeddingProvider(config.embedding);
  const qdrantClient = new QdrantClient({
    baseUrl: config.qdrant.baseUrl,
    apiKey: config.qdrant.apiKey,
    timeoutMs: config.qdrant.timeoutMs,
    collection: config.qdrant.collection,
  });
  const vectorStore = new QdrantKnowledgeStore({
    client: qdrantClient,
    dimensions: config.embedding.dimensions,
  });
  const cveRepository = new PrismaCveRepository(prisma);
  const nvdSource = new NvdKnowledgeSource(config.nvd);

  const ingestion: CveIngestionService = new DefaultCveIngestionService({
    source: nvdSource,
    cveRepository,
    embeddingProvider,
    vectorStore,
  });
  const rag = new DefaultRagService({
    embeddingProvider,
    vectorStore,
    contentRepository: cveRepository,
  });

  return {
    cveRepository,
    embeddingProvider,
    ingestion,
    rag,
    ensureVectorCollection: () => vectorStore.ensureCollection(),
  };
}