import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryContextStore } from '../src/storage/context-store.js';
import type { BoundedContext, ScopeRules } from '../src/core/types.js';

const defaultRules: ScopeRules = {
  selfWeight: 1.0,
  parentWeight: 0.8,
  siblingWeight: 0.5,
  childWeight: 0.9,
  depthDecay: 0.7,
  minWeight: 0.1,
  inheritRules: true,
};

function makeCtx(overrides?: Partial<BoundedContext>): BoundedContext {
  return {
    id: 'root',
    name: 'Root',
    description: 'Root context',
    childIds: [],
    scopeRules: defaultRules,
    writeRules: { writers: [] },
    metadata: {},
    ...overrides,
  };
}

describe('InMemoryContextStore', () => {
  let store: InMemoryContextStore;

  beforeEach(() => {
    store = new InMemoryContextStore();
  });

  it('creates and retrieves a context', async () => {
    await store.createContext(makeCtx());
    const ctx = await store.getContext('root');
    expect(ctx).not.toBeNull();
    expect(ctx!.name).toBe('Root');
  });

  it('throws on duplicate', async () => {
    await store.createContext(makeCtx());
    await expect(store.createContext(makeCtx())).rejects.toThrow('already exists');
  });

  it('maintains parent-child relationships', async () => {
    await store.createContext(makeCtx({ id: 'root' }));
    await store.createContext(makeCtx({ id: 'child1', name: 'Child 1', parentId: 'root' }));
    await store.createContext(makeCtx({ id: 'child2', name: 'Child 2', parentId: 'root' }));

    const children = await store.getChildren('root');
    expect(children).toHaveLength(2);

    const ancestors = await store.getAncestors('child1');
    expect(ancestors).toHaveLength(1);
    expect(ancestors[0].id).toBe('root');
  });

  it('gets siblings', async () => {
    await store.createContext(makeCtx({ id: 'root' }));
    await store.createContext(makeCtx({ id: 'a', parentId: 'root' }));
    await store.createContext(makeCtx({ id: 'b', parentId: 'root' }));
    await store.createContext(makeCtx({ id: 'c', parentId: 'root' }));

    const siblings = await store.getSiblings('a');
    expect(siblings).toHaveLength(2);
    expect(siblings.map((s) => s.id).sort()).toEqual(['b', 'c']);
  });

  it('gets descendants', async () => {
    await store.createContext(makeCtx({ id: 'root' }));
    await store.createContext(makeCtx({ id: 'l1', parentId: 'root' }));
    await store.createContext(makeCtx({ id: 'l2', parentId: 'l1' }));
    await store.createContext(makeCtx({ id: 'l3', parentId: 'l2' }));

    const descendants = await store.getDescendants('root');
    expect(descendants).toHaveLength(3);
  });

  it('removes from parent on delete', async () => {
    await store.createContext(makeCtx({ id: 'root' }));
    await store.createContext(makeCtx({ id: 'child', parentId: 'root' }));
    await store.deleteContext('child');

    const root = await store.getContext('root');
    expect(root!.childIds).not.toContain('child');
  });

  it('gets roots', async () => {
    await store.createContext(makeCtx({ id: 'r1' }));
    await store.createContext(makeCtx({ id: 'r2' }));
    await store.createContext(makeCtx({ id: 'c1', parentId: 'r1' }));

    const roots = await store.getRoots();
    expect(roots).toHaveLength(2);
  });
});
