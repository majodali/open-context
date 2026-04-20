import { describe, it, expect } from 'vitest';
import {
  OpenContext,
  DeterministicEmbedder,
  VectorRetriever,
  tagOverlapScore,
  parseTag,
  tagsByNamespace,
  tagValuesInNamespace,
  makeTag,
} from '../src/index.js';

// ── Tag utilities ──────────────────────────────────────────────────────────

describe('Tag utilities', () => {
  it('tagOverlapScore: full overlap', () => {
    expect(tagOverlapScore(['a', 'b'], ['a', 'b', 'c'])).toBe(1);
  });

  it('tagOverlapScore: partial overlap', () => {
    expect(tagOverlapScore(['a', 'b', 'c'], ['a'])).toBeCloseTo(1 / 3);
  });

  it('tagOverlapScore: no overlap', () => {
    expect(tagOverlapScore(['a', 'b'], ['c', 'd'])).toBe(0);
  });

  it('tagOverlapScore: empty query tags returns 0', () => {
    expect(tagOverlapScore([], ['a', 'b'])).toBe(0);
  });

  it('parseTag: namespaced', () => {
    expect(parseTag('domain:auth')).toEqual({ namespace: 'domain', value: 'auth' });
  });

  it('parseTag: unnamespaced', () => {
    expect(parseTag('experimental')).toEqual({ namespace: null, value: 'experimental' });
  });

  it('parseTag: handles colons in value', () => {
    // First colon is the separator
    expect(parseTag('url:http://example.com')).toEqual({
      namespace: 'url',
      value: 'http://example.com',
    });
  });

  it('tagsByNamespace filters correctly', () => {
    const tags = ['domain:auth', 'domain:api', 'severity:high', 'experimental'];
    expect(tagsByNamespace(tags, 'domain')).toEqual(['domain:auth', 'domain:api']);
    expect(tagsByNamespace(tags, 'severity')).toEqual(['severity:high']);
    expect(tagsByNamespace(tags, 'nonexistent')).toEqual([]);
  });

  it('tagValuesInNamespace returns values only', () => {
    const tags = ['domain:auth', 'domain:api', 'severity:high'];
    expect(tagValuesInNamespace(tags, 'domain')).toEqual(['auth', 'api']);
  });

  it('makeTag builds namespaced tag', () => {
    expect(makeTag('domain', 'auth')).toBe('domain:auth');
  });
});

// ── Tag-aware retrieval ─────────────────────────────────────────────────────

describe('Tag-aware retrieval (VectorRetriever)', () => {
  async function setupRetriever() {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const retriever = new VectorRetriever({
      embedder: oc.embedder,
      vectorStore: oc.vectorStore,
      unitStore: oc.unitStore,
      contextStore: oc.contextStore,
      scopeResolver: oc.scopeResolver,
    });

    return { oc, ctx, retriever };
  }

  it('without tag boost, scores match base behavior', async () => {
    const { oc, ctx, retriever } = await setupRetriever();
    await oc.acquire('Authentication is required for all endpoints', ctx.id, {
      tags: ['domain:auth'],
    });
    await oc.acquire('Rate limiting prevents abuse', ctx.id, {
      tags: ['domain:api'],
    });

    const result = await retriever.retrieve('security requirements', {
      contextId: ctx.id,
      maxResults: 10,
      // No queryTags, no tagBoostFactor
    });

    expect(result.units.length).toBeGreaterThan(0);
    for (const su of result.units) {
      // Score = vectorSimilarity * scopeWeight (no tag boost)
      expect(su.score).toBeCloseTo(su.vectorSimilarity * su.scopeWeight, 5);
      expect(su.tagBoost ?? 0).toBe(0);
    }
  });

  it('with tag boost, units sharing tags are boosted', async () => {
    const { oc, ctx, retriever } = await setupRetriever();

    // Two units with similar embedding, different tags
    await oc.acquire('Always validate input data', ctx.id, {
      tags: ['domain:auth', 'security'],
    });
    await oc.acquire('Always validate input data', ctx.id, {
      tags: ['domain:frontend'],
    });

    // Query with auth-related tags
    const result = await retriever.retrieve('input validation', {
      contextId: ctx.id,
      maxResults: 10,
      queryTags: ['domain:auth', 'security'],
      tagBoostFactor: 1.0,
    });

    expect(result.units).toHaveLength(2);
    // The auth-tagged unit should rank first (full overlap = 1.0 boost = 2x score)
    const authUnit = result.units.find((su) =>
      su.unit.metadata.tags.includes('domain:auth'),
    )!;
    const frontendUnit = result.units.find((su) =>
      su.unit.metadata.tags.includes('domain:frontend'),
    )!;

    expect(authUnit).toBeDefined();
    expect(frontendUnit).toBeDefined();
    expect(authUnit.score).toBeGreaterThan(frontendUnit.score);
    expect(authUnit.tagBoost).toBeCloseTo(1.0); // both query tags matched
    expect(frontendUnit.tagBoost).toBeCloseTo(0);
  });

  it('partial tag overlap gives partial boost', async () => {
    const { oc, ctx, retriever } = await setupRetriever();
    await oc.acquire('Test content', ctx.id, {
      tags: ['domain:auth'], // matches 1 of 2 query tags
    });

    const result = await retriever.retrieve('content', {
      contextId: ctx.id,
      maxResults: 10,
      queryTags: ['domain:auth', 'severity:high'],
      tagBoostFactor: 1.0,
    });

    expect(result.units[0].tagBoost).toBeCloseTo(0.5); // 1 of 2 matched
    // Score should be vectorSimilarity * scopeWeight * (1 + 1.0 * 0.5) = 1.5x
    expect(result.units[0].score).toBeCloseTo(
      result.units[0].vectorSimilarity * result.units[0].scopeWeight * 1.5,
      5,
    );
  });

  it('flatScope ignores hierarchical weighting', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    // Use legacy hierarchical scope rules to exercise hierarchical weighting
    // (default is flat in current OpenContext)
    const hierRules = {
      selfWeight: 1.0,
      parentWeight: 0.8,
      siblingWeight: 0.5,
      childWeight: 0.9,
      depthDecay: 0.7,
      minWeight: 0.1,
      inheritRules: true,
    };
    const root = await oc.createContext({
      name: 'Root',
      description: 'Root',
      scopeRules: hierRules,
    });
    const child = await oc.createContext({
      name: 'Child',
      description: 'Child',
      parentId: root.id,
      scopeRules: hierRules,
    });

    await oc.acquire('Test fact in root', root.id);
    await oc.acquire('Test fact in child', child.id);

    const retriever = new VectorRetriever({
      embedder: oc.embedder,
      vectorStore: oc.vectorStore,
      unitStore: oc.unitStore,
      contextStore: oc.contextStore,
      scopeResolver: oc.scopeResolver,
    });

    // From child context, with hierarchical weighting
    const hierarchical = await retriever.retrieve('test', {
      contextId: child.id,
      maxResults: 10,
    });
    const childInH = hierarchical.units.find((su) => su.unit.contextId === child.id)!;
    const rootInH = hierarchical.units.find((su) => su.unit.contextId === root.id)!;
    expect(childInH.scopeWeight).toBe(1.0); // self
    expect(rootInH.scopeWeight).toBeLessThan(1.0); // parent

    // Same query with flatScope
    const flat = await retriever.retrieve('test', {
      contextId: child.id,
      maxResults: 10,
      flatScope: true,
    });
    for (const su of flat.units) {
      expect(su.scopeWeight).toBe(1.0); // all weights are 1.0
    }
  });

  it('combined: tag boost + hierarchical weighting work together', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    const child = await oc.createContext({
      name: 'Child',
      description: 'Child',
      parentId: root.id,
    });

    // Same content in both, but child has matching tag
    await oc.acquire('Critical security rule', root.id, { tags: ['general'] });
    await oc.acquire('Critical security rule', child.id, { tags: ['domain:auth'] });

    const retriever = new VectorRetriever({
      embedder: oc.embedder,
      vectorStore: oc.vectorStore,
      unitStore: oc.unitStore,
      contextStore: oc.contextStore,
      scopeResolver: oc.scopeResolver,
    });

    const result = await retriever.retrieve('security', {
      contextId: child.id,
      maxResults: 10,
      queryTags: ['domain:auth'],
      tagBoostFactor: 1.0,
    });

    const childUnit = result.units.find((su) => su.unit.contextId === child.id)!;
    const rootUnit = result.units.find((su) => su.unit.contextId === root.id)!;

    // Child unit should rank first (better scope + tag match)
    expect(childUnit.score).toBeGreaterThan(rootUnit.score);
    expect(childUnit.tagBoost).toBeCloseTo(1.0);
    expect(rootUnit.tagBoost).toBeCloseTo(0);
  });
});
