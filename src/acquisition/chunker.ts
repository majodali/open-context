/**
 * Chunker interface and default implementation.
 * Breaks content into semantic units (sentences/paragraphs).
 */

import type { ChunkOptions, ChunkResult } from '../core/types.js';

export interface Chunker {
  chunk(content: string, options?: Partial<ChunkOptions>): ChunkResult[];
}

const DEFAULT_OPTIONS: ChunkOptions = {
  maxChunkSize: 500,
  preserveContext: true,
  contentType: undefined,
};

/**
 * Default chunker: splits on sentence boundaries.
 * When preserveContext is true, keeps multi-sentence chunks together
 * if splitting would produce fragments under a minimum size.
 */
export class DefaultChunker implements Chunker {
  private minChunkSize: number;

  constructor(minChunkSize = 20) {
    this.minChunkSize = minChunkSize;
  }

  chunk(content: string, options?: Partial<ChunkOptions>): ChunkResult[] {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // noChunking: return content verbatim as a single chunk.
    // Useful for structured content (JSON, YAML, code) where exact
    // formatting must be preserved.
    if (opts.noChunking) {
      const trimmed = content.trim();
      return trimmed.length > 0 ? [{ content, index: 0 }] : [];
    }

    const trimmed = content.trim();
    if (!trimmed) return [];

    // Split into sentences
    const sentences = this.splitSentences(trimmed);

    if (!opts.preserveContext) {
      // Simple: each sentence is a chunk (respecting maxChunkSize)
      return this.splitBySize(sentences, opts.maxChunkSize);
    }

    // Preserve context: merge small sentences, respect max size
    return this.mergeAndSplit(sentences, opts.maxChunkSize);
  }

  private splitSentences(text: string): string[] {
    // Split on sentence-ending punctuation followed by whitespace or end of string.
    // This is a simple heuristic — can be upgraded to an NLP-based splitter.
    const raw = text.split(/(?<=[.!?])\s+/);
    return raw.map((s) => s.trim()).filter((s) => s.length > 0);
  }

  private splitBySize(sentences: string[], maxSize: number): ChunkResult[] {
    const results: ChunkResult[] = [];
    let index = 0;

    for (const sentence of sentences) {
      if (sentence.length <= maxSize) {
        results.push({ content: sentence, index: index++ });
      } else {
        // Force-split long sentences at word boundaries
        const words = sentence.split(/\s+/);
        let current = '';
        for (const word of words) {
          if (current.length + word.length + 1 > maxSize && current.length > 0) {
            results.push({ content: current.trim(), index: index++ });
            current = '';
          }
          current += (current.length > 0 ? ' ' : '') + word;
        }
        if (current.trim().length > 0) {
          results.push({ content: current.trim(), index: index++ });
        }
      }
    }

    return results;
  }

  private mergeAndSplit(sentences: string[], maxSize: number): ChunkResult[] {
    const results: ChunkResult[] = [];
    let current = '';
    let index = 0;

    for (const sentence of sentences) {
      if (current.length === 0) {
        current = sentence;
      } else if (current.length + sentence.length + 1 <= maxSize) {
        current += ' ' + sentence;
      } else {
        // Current is full enough — emit it
        if (current.length >= this.minChunkSize) {
          results.push({ content: current, index: index++ });
          current = sentence;
        } else {
          // Current is too small, force merge
          current += ' ' + sentence;
        }
      }
    }

    // Emit remaining
    if (current.trim().length > 0) {
      // If the last chunk is very small, merge with previous
      if (
        current.trim().length < this.minChunkSize &&
        results.length > 0 &&
        results[results.length - 1].content.length + current.trim().length + 1 <= maxSize
      ) {
        results[results.length - 1].content += ' ' + current.trim();
      } else {
        results.push({ content: current.trim(), index: index++ });
      }
    }

    return results;
  }
}
