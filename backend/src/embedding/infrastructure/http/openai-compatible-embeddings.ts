/**
 * OpenAI-compatible embeddings substrate (today only Gemini uses it via
 * Google's official OpenAI-compatible endpoint).
 *
 * Wire shape: POST {base}/embeddings {model, input} → {data: [{index,
 * embedding}]}. Bounded retries on transient failures (429/5xx/network),
 * dimension validation, redacted errors. No SDKs.
 */

import {
  EmbeddingAuthenticationError,
  EmbeddingDimensionError,
  EmbeddingError,
  EmbeddingResponseError,
  EmbeddingTimeoutError,
  EmbeddingUnavailableError,
} from '../../domain/errors/embedding.errors';
import type { EmbeddingProvider } from '../../domain/ports/embedding-provider';
import { redactSensitive } from '../../../llm/infrastructure/redact/redactor';

export interface OpenAICompatibleEmbeddingOptions {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
  readonly dimensions: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

const RETRY_BACKOFF_BASE_MS = 350;
const MAX_BACKOFF_MS = 4_000;

function isRetryable(error: EmbeddingError): boolean {
  return error.code === 'UNAVAILABLE' || error.code === 'TIMEOUT';
}

export class OpenAICompatibleEmbeddingClient implements EmbeddingProvider {
  private readonly o: OpenAICompatibleEmbeddingOptions;

  constructor(options: OpenAICompatibleEmbeddingOptions) {
    this.o = options;
  }

  dimensions(): number {
    return this.o.dimensions;
  }

  async embedText(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const vectors = await this.withRetries(texts, 0);
    for (const vector of vectors) {
      if (vector.length !== this.o.dimensions) {
        throw new EmbeddingDimensionError(this.o.model, this.o.dimensions, vector.length);
      }
    }
    return vectors;
  }

  // --- internals ---------------------------------------------------------

  private async withRetries(texts: readonly string[], attempt: number): Promise<number[][]> {
    try {
      return await this.sendOnce(texts);
    } catch (error) {
      if (attempt >= this.o.maxRetries || !(error instanceof EmbeddingError) || !isRetryable(error)) {
        throw error;
      }
      const waitMs = Math.min(RETRY_BACKOFF_BASE_MS * (attempt + 1), MAX_BACKOFF_MS);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return this.withRetries(texts, attempt + 1);
    }
  }

  private async sendOnce(texts: readonly string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.o.timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(`${this.o.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.o.apiKey ?? ''}`,
          },
          body: JSON.stringify({ model: this.o.model, input: texts }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new EmbeddingTimeoutError('gemini', this.o.timeoutMs);
        }
        throw new EmbeddingUnavailableError('gemini', 'network failure', error);
      }

      const bodyText = await response.text();
      if (!response.ok) {
        const detail = redactSensitive(bodyText.slice(0, 200));
        if (response.status === 401 || response.status === 403) {
          throw new EmbeddingAuthenticationError('gemini', detail);
        }
        if (response.status === 429 || response.status >= 500) {
          throw new EmbeddingUnavailableError(
            'gemini',
            `status ${response.status}`,
            new Error(`http ${response.status}`),
          );
        }
        throw new EmbeddingResponseError('gemini', detail);
      }
      return parseEmbeddings(bodyText);
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseEmbeddings(bodyText: string): number[][] {
  let data: unknown;
  try {
    data = JSON.parse(bodyText) as unknown;
  } catch {
    throw new EmbeddingResponseError('gemini', 'response was not JSON');
  }
  const root = asRecord(data);
  const rows = root?.['data'];
  if (!Array.isArray(rows)) {
    throw new EmbeddingResponseError('gemini', 'missing data[]');
  }
  const vectors = rows.map((row) => {
    const record = asRecord(row);
    const embedding = record?.['embedding'];
    if (!Array.isArray(embedding) || embedding.some((v) => typeof v !== 'number')) {
      throw new EmbeddingResponseError('gemini', 'embedding is not a number[]');
    }
    return embedding as number[];
  });
  if (vectors.length === 0) {
    throw new EmbeddingResponseError('gemini', 'empty data[]');
  }
  return vectors;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}