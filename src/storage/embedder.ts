/**
 * Embedder interface and implementations.
 * Pluggable — provide your own for local models, different APIs, etc.
 */

export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}

/**
 * Returns zero vectors. Useful for testing pipeline logic without an API dependency.
 */
export class NoopEmbedder implements Embedder {
  readonly dimensions: number;

  constructor(dimensions = 384) {
    this.dimensions = dimensions;
  }

  async embed(_text: string): Promise<number[]> {
    return new Array(this.dimensions).fill(0);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(this.dimensions).fill(0));
  }
}

/**
 * Simple deterministic embedder for testing — produces consistent embeddings
 * based on text content (hash-based). Not semantically meaningful, but stable.
 */
export class DeterministicEmbedder implements Embedder {
  readonly dimensions: number;

  constructor(dimensions = 384) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    return this.hashToVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.hashToVector(t));
  }

  private hashToVector(text: string): number[] {
    const vec = new Array(this.dimensions).fill(0);
    for (let i = 0; i < text.length; i++) {
      const idx = i % this.dimensions;
      vec[idx] += text.charCodeAt(i);
    }
    // Normalize to unit vector
    let mag = 0;
    for (let i = 0; i < vec.length; i++) mag += vec[i] * vec[i];
    mag = Math.sqrt(mag);
    if (mag > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= mag;
    }
    return vec;
  }
}

/**
 * OpenAI embeddings implementation.
 * Requires an API key and network access.
 */
export class OpenAIEmbedder implements Embedder {
  readonly dimensions: number;
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(options: {
    apiKey: string;
    model?: string;
    dimensions?: number;
    baseUrl?: string;
  }) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'text-embedding-3-small';
    this.dimensions = options.dimensions ?? 1536;
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.embedBatch([text]);
    return result[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI embeddings API error: ${response.status} ${err}`);
    }

    const data = (await response.json()) as {
      data: { embedding: number[]; index: number }[];
    };

    // Sort by index to maintain order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}
