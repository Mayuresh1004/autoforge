/**
 * Knowledge routes — composition root (matches the sandbox pattern: module
 * singleton infrastructure built on the shared Prisma client; everything is
 * lazy — no network traffic until a handler actually calls a service).
 *
 * POST /api/knowledge/cve/ingest
 * GET  /api/knowledge/cve/:cveId
 * POST /api/rag/search
 */

import { Router } from 'express';
import { prisma } from '../../../config/database';
import { embeddingConfig, knowledgeConfig } from '../../../config';
import { createKnowledgeInfrastructure } from '../../infrastructure/factory/knowledge-factory';
import { KnowledgeController } from '../controllers/knowledge.controller';

const infrastructure = createKnowledgeInfrastructure(
  {
    embedding: embeddingConfig,
    nvd: knowledgeConfig.nvd,
    qdrant: knowledgeConfig.qdrant,
  },
  prisma,
);

const controller = new KnowledgeController({
  ingestion: infrastructure.ingestion,
  rag: infrastructure.rag,
  cveRepository: infrastructure.cveRepository,
});

const router = Router();

router.post('/knowledge/cve/ingest', controller.ingestCve);
router.get('/knowledge/cve/:cveId', controller.getCve);
router.post('/rag/search', controller.ragSearch);

export { router as knowledgeRoutes };
export { infrastructure as knowledgeInfrastructure };