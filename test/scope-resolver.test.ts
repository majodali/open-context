import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultScopeResolver } from '../src/retrieval/scope-resolver.js';
import { InMemoryContextStore } from '../src/storage/context-store.js';
import type { BoundedContext, ScopeRules } from '../src/core/types.js';

const rules: ScopeRules = {
  selfWeight: 1.0,
  parentWeight: 0.8,
  siblingWeight: 0.5,
  childWeight: 0.9,
  depthDecay: 0.7,
  minWeight: 0.1,
  inheritRules: true,
};

function makeCtx(id: string, parentId?: string): BoundedContext {
  return {
    id,
    name: id,
    description: '',
    parentId,
    childIds: [],
    scopeRules: rules,
    writeRules: { writers: [] },
    metadata: {},
  };
}

describe('DefaultScopeResolver', () => {
  let store: InMemoryContextStore;
  let resolver: DefaultScopeResolver;

  beforeEach(async () => {
    store = new InMemoryContextStore();
    resolver = new DefaultScopeResolver();

    // Build hierarchy:
    //       root
    //      /    \
    //    auth   payment
    //    /
    //  login
    await store.createContext(makeCtx('root'));
    await store.createContext(makeCtx('auth', 'root'));
    await store.createContext(makeCtx('payment', 'root'));
    await store.createContext(makeCtx('login', 'auth'));
  });

  it('includes self with full weight', async () => {
    const scopes = await resolver.resolve('auth', store);
    const self = scopes.find((s) => s.contextId === 'auth');
    expect(self).toBeDefined();
    expect(self!.weight).toBe(1.0);
    expect(self!.relationship).toBe('self');
  });

  it('includes parent with parentWeight', async () => {
    const scopes = await resolver.resolve('auth', store);
    const parent = scopes.find((s) => s.contextId === 'root');
    expect(parent).toBeDefined();
    expect(parent!.weight).toBe(0.8);
    expect(parent!.relationship).toBe('parent');
  });

  it('includes siblings with siblingWeight', async () => {
    const scopes = await resolver.resolve('auth', store);
    const sibling = scopes.find((s) => s.contextId === 'payment');
    expect(sibling).toBeDefined();
    expect(sibling!.weight).toBe(0.5);
    expect(sibling!.relationship).toBe('sibling');
  });

  it('includes children with childWeight', async () => {
    const scopes = await resolver.resolve('auth', store);
    const child = scopes.find((s) => s.contextId === 'login');
    expect(child).toBeDefined();
    expect(child!.weight).toBe(0.9);
    expect(child!.relationship).toBe('child');
  });

  it('applies depth decay to distant ancestors', async () => {
    const scopes = await resolver.resolve('login', store);
    const root = scopes.find((s) => s.contextId === 'root');
    expect(root).toBeDefined();
    // login → auth (depth 1, weight 0.8) → root (depth 2, weight 0.8 * 0.7 = 0.56)
    expect(root!.weight).toBeCloseTo(0.56, 1);
    expect(root!.relationship).toBe('ancestor');
  });

  it('never goes below minWeight', async () => {
    const scopes = await resolver.resolve('login', store);
    for (const scope of scopes) {
      expect(scope.weight).toBeGreaterThanOrEqual(rules.minWeight);
    }
  });

  it('returns empty for nonexistent context', async () => {
    const scopes = await resolver.resolve('nonexistent', store);
    expect(scopes).toHaveLength(0);
  });
});
