/**
 * NoopEmbeddingProvider — a safe local fallback when no embedding key is
 * configured. It never contacts the network and returns zero vectors of the
 * configured dimensions. The RAG/Qdrant paths still boot; real semantic
 * search only activates when a real provider is configured.
 */

export class NoopEmbeddingProvider {
  constructor(private readonly vectorDimensions: number) {}

  async embedText(_text: string): Promise<number[]> {
    return new Array(this.vectorDimensions).fill(0);
  }

  async embedBatch(texts: readonly string[]): Promise<number[][]> {
    return texts.map(() => new Array(this.vectorDimensions).fill(0));
  }

  dimensions(): number {
    return this.vectorDimensions;
  }
}
