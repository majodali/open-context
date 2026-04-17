/**
 * Local embeddings using @huggingface/transformers (ONNX runtime).
 * No external API needed — models are downloaded on first use and cached locally.
 *
 * Recommended models:
 * - 'Xenova/bge-small-en-v1.5' (384 dims, ~130MB, good quality)
 * - 'Xenova/all-MiniLM-L6-v2' (384 dims, ~90MB, fast)
 * - 'Xenova/bge-base-en-v1.5' (768 dims, ~440MB, higher quality)
 */

import type { Embedder } from './embedder.js';

export interface TransformersEmbedderConfig {
  /** HuggingFace model ID. Default: 'Xenova/bge-small-en-v1.5' */
  model: string;
  /** Expected embedding dimensions. Default: 384 */
  dimensions: number;
  /** Whether to normalize embeddings to unit vectors. Default: true */
  normalize: boolean;
}

const DEFAULT_CONFIG: TransformersEmbedderConfig = {
  model: 'Xenova/bge-small-en-v1.5',
  dimensions: 384,
  normalize: true,
};

/**
 * Local embedding model using @huggingface/transformers.
 * The model is loaded lazily on first embed() call.
 * First call includes model download time (~30s); subsequent calls are fast (~50ms).
 */
export class TransformersEmbedder implements Embedder {
  readonly dimensions: number;
  private config: TransformersEmbedderConfig;
  private pipelinePromise: Promise<any> | null = null;
  private initError: Error | null = null;

  constructor(config?: Partial<TransformersEmbedderConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dimensions = this.config.dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.embedBatch([text]);
    return result[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const extractor = await this.getExtractor();
    const results: number[][] = [];

    for (const text of texts) {
      const output = await extractor(text, {
        pooling: 'mean',
        normalize: this.config.normalize,
      });
      // output.data is a Float32Array or similar typed array
      results.push(Array.from(output.data as Float32Array));
    }

    return results;
  }

  private async getExtractor(): Promise<any> {
    if (this.initError) {
      throw this.initError;
    }

    if (!this.pipelinePromise) {
      this.pipelinePromise = this.initPipeline();
    }

    return this.pipelinePromise;
  }

  private async initPipeline(): Promise<any> {
    try {
      // Dynamic import to avoid issues if the package isn't installed
      const { pipeline } = await import('@huggingface/transformers');
      const extractor = await pipeline('feature-extraction', this.config.model, {
        // Use default cache directory
      });
      return extractor;
    } catch (err) {
      this.initError = err instanceof Error
        ? err
        : new Error(`Failed to initialize transformers: ${err}`);
      throw this.initError;
    }
  }
}
