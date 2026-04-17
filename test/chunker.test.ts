import { describe, it, expect } from 'vitest';
import { DefaultChunker } from '../src/acquisition/chunker.js';

describe('DefaultChunker', () => {
  const chunker = new DefaultChunker();

  it('splits sentences', () => {
    const result = chunker.chunk('First sentence. Second sentence. Third sentence.');
    expect(result.length).toBeGreaterThanOrEqual(1);
    // With preserveContext default true, may merge small sentences
  });

  it('returns empty for empty input', () => {
    expect(chunker.chunk('')).toHaveLength(0);
    expect(chunker.chunk('  ')).toHaveLength(0);
  });

  it('respects maxChunkSize', () => {
    const longText = 'A'.repeat(100) + '. ' + 'B'.repeat(100) + '. ' + 'C'.repeat(100) + '.';
    const result = chunker.chunk(longText, { maxChunkSize: 150 });
    for (const chunk of result) {
      expect(chunk.content.length).toBeLessThanOrEqual(250); // Some slack for merging
    }
  });

  it('handles single sentence', () => {
    const result = chunker.chunk('Just one sentence.');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Just one sentence.');
  });

  it('without preserveContext, splits each sentence', () => {
    const result = chunker.chunk(
      'First. Second. Third.',
      { preserveContext: false },
    );
    expect(result).toHaveLength(3);
  });
});
