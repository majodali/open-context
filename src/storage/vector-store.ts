/**
 * Vector store interface and in-memory implementation using brute-force cosine similarity.
 * This is the v1 implementation — swap in HNSW, Pinecone, Qdrant, etc. via the interface.
 */

import type { SearchResult, FilterFn } from '../core/types.js';

export interface VectorStore {
  add(id: string, embedding: number[], metadata?: Record<string, unknown>): Promise<void>;
  search(query: number[], k: number, filter?: FilterFn): Promise<SearchResult[]>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

interface VectorEntry {
  id: string;
  embedding: number[];
  magnitude: number;
  metadata?: Record<string, unknown>;
}

function computeMagnitude(vec: number[]): number {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i] * vec[i];
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(a: number[], aMag: number, b: number[], bMag: number): number {
  if (aMag === 0 || bMag === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot / (aMag * bMag);
}

/**
 * In-memory vector store using brute-force cosine similarity.
 * Suitable for development and small-to-medium datasets.
 * For production, implement the VectorStore interface with HNSW or a cloud service.
 */
export class InMemoryVectorStore implements VectorStore {
  private entries = new Map<string, VectorEntry>();

  async add(id: string, embedding: number[], metadata?: Record<string, unknown>): Promise<void> {
    this.entries.set(id, {
      id,
      embedding,
      magnitude: computeMagnitude(embedding),
      metadata,
    });
  }

  async search(query: number[], k: number, filter?: FilterFn): Promise<SearchResult[]> {
    const queryMag = computeMagnitude(query);
    const results: SearchResult[] = [];

    for (const entry of this.entries.values()) {
      if (filter && !filter(entry.id, entry.metadata)) continue;

      const score = cosineSimilarity(query, queryMag, entry.embedding, entry.magnitude);
      results.push({ id: entry.id, score, metadata: entry.metadata });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async count(): Promise<number> {
    return this.entries.size;
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}
