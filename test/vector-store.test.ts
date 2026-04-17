import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryVectorStore } from '../src/storage/vector-store.js';

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore();
  });

  it('adds and searches vectors', async () => {
    await store.add('a', [1, 0, 0]);
    await store.add('b', [0, 1, 0]);
    await store.add('c', [0.9, 0.1, 0]);

    const results = await store.search([1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('a'); // Exact match
    expect(results[1].id).toBe('c'); // Close match
  });

  it('applies filter', async () => {
    await store.add('a', [1, 0, 0], { group: 'x' });
    await store.add('b', [0.9, 0.1, 0], { group: 'y' });

    const results = await store.search(
      [1, 0, 0],
      10,
      (_id, meta) => meta?.['group'] === 'y',
    );
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('b');
  });

  it('deletes vectors', async () => {
    await store.add('a', [1, 0, 0]);
    await store.delete('a');
    expect(await store.count()).toBe(0);
  });

  it('handles zero vectors gracefully', async () => {
    await store.add('zero', [0, 0, 0]);
    const results = await store.search([1, 0, 0], 1);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(0);
  });
});
