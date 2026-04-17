import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryUnitStore } from '../src/storage/unit-store.js';
import type { SemanticUnit } from '../src/core/types.js';

function makeUnit(overrides?: Partial<SemanticUnit>): SemanticUnit {
  return {
    id: 'u1',
    content: 'Test content',
    metadata: {
      source: 'test',
      sourceType: 'user',
      contentType: 'statement',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [],
    },
    contextId: 'ctx1',
    usage: {
      retrievalCount: 0,
      inclusionCount: 0,
      outcomeSignals: [],
    },
    ...overrides,
  };
}

describe('InMemoryUnitStore', () => {
  let store: InMemoryUnitStore;

  beforeEach(() => {
    store = new InMemoryUnitStore();
  });

  it('adds and retrieves a unit', async () => {
    const unit = makeUnit();
    await store.add(unit);
    const retrieved = await store.get('u1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toBe('Test content');
  });

  it('returns null for missing unit', async () => {
    expect(await store.get('nonexistent')).toBeNull();
  });

  it('gets units by context', async () => {
    await store.add(makeUnit({ id: 'u1', contextId: 'ctx1' }));
    await store.add(makeUnit({ id: 'u2', contextId: 'ctx1' }));
    await store.add(makeUnit({ id: 'u3', contextId: 'ctx2' }));

    const ctx1Units = await store.getByContext('ctx1');
    expect(ctx1Units).toHaveLength(2);

    const ctx2Units = await store.getByContext('ctx2');
    expect(ctx2Units).toHaveLength(1);
  });

  it('gets units by multiple contexts', async () => {
    await store.add(makeUnit({ id: 'u1', contextId: 'ctx1' }));
    await store.add(makeUnit({ id: 'u2', contextId: 'ctx2' }));
    await store.add(makeUnit({ id: 'u3', contextId: 'ctx3' }));

    const units = await store.getByContexts(['ctx1', 'ctx3']);
    expect(units).toHaveLength(2);
  });

  it('records retrieval usage', async () => {
    await store.add(makeUnit());
    await store.recordUsage('u1', 'retrieval');
    const unit = await store.get('u1');
    expect(unit!.usage.retrievalCount).toBe(1);
    expect(unit!.usage.lastRetrievedAt).toBeDefined();
  });

  it('records inclusion usage with outcome signal', async () => {
    await store.add(makeUnit());
    await store.recordUsage('u1', 'inclusion', {
      timestamp: Date.now(),
      type: 'positive',
      source: 'test',
    });
    const unit = await store.get('u1');
    expect(unit!.usage.inclusionCount).toBe(1);
    expect(unit!.usage.outcomeSignals).toHaveLength(1);
    expect(unit!.usage.outcomeSignals[0].type).toBe('positive');
  });

  it('deletes a unit', async () => {
    await store.add(makeUnit());
    await store.delete('u1');
    expect(await store.get('u1')).toBeNull();
    expect(await store.getByContext('ctx1')).toHaveLength(0);
  });

  it('updates unit and handles context change', async () => {
    await store.add(makeUnit());
    await store.update('u1', { contextId: 'ctx2' });
    expect(await store.getByContext('ctx1')).toHaveLength(0);
    expect(await store.getByContext('ctx2')).toHaveLength(1);
  });
});
