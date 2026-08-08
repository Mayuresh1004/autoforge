/**
 * Deterministic, offline embedding provider for tests: vectors derived from
 * character 3-gram hashing into a fixed-dimension space. Semantic-ish (shared
 * substrings correlate with cosine similarity), fully deterministic, no
 * network. Lets RAG ranking tests be exact and repeatable.
 */

import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from '../../../src/embedding/domain/ports/embedding-provider';

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  private readonly dims: number;

  constructor(dims = 64) {
    this.dims = dims;
  }

  dimensions(): number {
    return this.dims;
  }

  embedText(text: string): Promise<number[]> {
    return Promise.resolve(hashEmbedding(text, this.dims));
  }

  embedBatch(texts: readonly string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => hashEmbedding(text, this.dims)));
  }
}

function hashEmbedding(text: string, dims: number): number[] {
  const vector = new Array<number>(dims).fill(0);
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  for (let index = 0; index + 2 < normalized.length; index += 1) {
    const gram = normalized.slice(index, index + 3);
    const digest = createHash('sha256').update(gram).digest();
    const slot = digest[0] % dims;
    vector[slot] += (digest[1] ?? 1) / 255;
  }
  const magnitude = Math.sqrt(vector.reduce((acc, component) => acc + component * component, 0));
  if (magnitude === 0) return vector;
  return vector.map((component) => component / magnitude);
}