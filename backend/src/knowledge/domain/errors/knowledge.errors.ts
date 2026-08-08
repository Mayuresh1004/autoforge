/**
 * Knowledge-module errors. Stable codes for the API layer.
 */

export type KnowledgeErrorCode =
  | 'INVALID_DOCUMENT'
  | 'SOURCE_ERROR'
  | 'STORE_UNAVAILABLE'
  | 'INGESTION_FAILED'
  | 'NOT_FOUND'
  | 'RAG_VALIDATION';

export class KnowledgeError extends Error {
  readonly code: KnowledgeErrorCode;
  constructor(code: KnowledgeErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'KnowledgeError';
    this.code = code;
  }
}

/** A source record failed validation (malformed/unknown shape). */
export class InvalidKnowledgeDocumentError extends KnowledgeError {
  constructor(detail: string) {
    super('INVALID_DOCUMENT', `invalid knowledge document: ${detail}`);
    this.name = 'InvalidKnowledgeDocumentError';
  }
}

/** Upstream source failed after bounded retries. */
export class KnowledgeSourceError extends KnowledgeError {
  readonly source: string;
  constructor(source: string, detail: string, cause?: unknown) {
    super('SOURCE_ERROR', `knowledge source '${source}' failed: ${detail}`, cause);
    this.name = 'KnowledgeSourceError';
    this.source = source;
  }
}

/** Vector store unreachable. */
export class KnowledgeStoreUnavailableError extends KnowledgeError {
  constructor(detail: string, cause?: unknown) {
    super('STORE_UNAVAILABLE', `knowledge store unavailable: ${detail}`, cause);
    this.name = 'KnowledgeStoreUnavailableError';
  }
}

/** No records changed / nothing to do (informational). */
export class KnowledgeIngestionError extends KnowledgeError {
  constructor(detail: string, cause?: unknown) {
    super('INGESTION_FAILED', `knowledge ingestion failed: ${detail}`, cause);
    this.name = 'KnowledgeIngestionError';
  }
}

export class KnowledgeNotFoundError extends KnowledgeError {
  constructor(detail: string) {
    super('NOT_FOUND', `knowledge record not found: ${detail}`);
    this.name = 'KnowledgeNotFoundError';
  }
}