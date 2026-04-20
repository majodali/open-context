import { describe, it, expect } from 'vitest';
import {
  OpenContext,
  DeterministicEmbedder,
  FeatureRetriever,
  extractFeatures,
  scoreFromFeatures,
  FEATURE_NAMES,
  DEFAULT_WEIGHTS,
  WEIGHTS_VECTOR_ONLY,
  WEIGHTS_TAG_HEAVY,
  computeContextTags,
  InMemoryTrainingDataStore,
  relevanceLevelToLabel,
} from '../src/index.js';
import type { SemanticUnit, TrainingExample } from '../src/index.js';

// ── Auto-context tags ──────────────────────────────────────────────────────

describe('computeContextTags', () => {
  it('returns just direct context tag when no store available', async () => {
    const tags = await computeContextTags('ctx-xyz');
    expect(tags).toEqual(['context:ctx-xyz']);
  });

  it('walks ancestor chain from context store', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    const mid = await oc.createContext({
      name: 'Mid',
      description: 'Mid',
      parentId: root.id,
    });
    const leaf = await oc.createContext({
      name: 'Leaf',
      description: 'Leaf',
      parentId: mid.id,
    });

    const tags = await computeContextTags(leaf.id, oc.contextStore);
    expect(tags).toContain(`context:${leaf.id}`);
    expect(tags).toContain(`ancestor:${mid.id}`);
    expect(tags).toContain(`ancestor:${root.id}`);
    expect(tags).toHaveLength(3);
  });

  it('auto-context tags are applied during acquisition', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    const child = await oc.createContext({
      name: 'Child',
      description: 'Child',
      parentId: root.id,
    });

    const units = await oc.acquire('Some content', child.id, {
      tags: ['user-provided'],
    });
    expect(units[0].metadata.tags).toContain(`context:${child.id}`);
    expect(units[0].metadata.tags).toContain(`ancestor:${root.id}`);
    expect(units[0].metadata.tags).toContain('user-provided');
  });
});

// ── Feature extraction ─────────────────────────────────────────────────────

function makeUnit(overrides?: Partial<SemanticUnit>): SemanticUnit {
  return {
    id: 'u1',
    content: 'Test content',
    metadata: {
      source: 'test',
      sourceType: 'user',
      contentType: 'fact',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [],
    },
    contextId: 'ctx-1',
    usage: { retrievalCount: 0, inclusionCount: 0, outcomeSignals: [] },
    ...overrides,
  };
}

describe('extractFeatures', () => {
  it('vectorSimilarity clamps to [0, 1]', () => {
    const unit = makeUnit();
    const f1 = extractFeatures({ vectorSimilarity: 0.7, queryTags: [], unit });
    expect(f1.vectorSimilarity).toBe(0.7);
    const f2 = extractFeatures({ vectorSimilarity: 1.5, queryTags: [], unit });
    expect(f2.vectorSimilarity).toBe(1);
    const f3 = extractFeatures({ vectorSimilarity: -0.1, queryTags: [], unit });
    expect(f3.vectorSimilarity).toBe(0);
  });

  it('tag overlap features are per-namespace', () => {
    const unit = makeUnit({
      metadata: {
        ...makeUnit().metadata,
        tags: [
          'context:auth',
          'domain:auth',
          'applies-to:User',
          'methodology:v-model',
          'other',
        ],
      },
    });

    const features = extractFeatures({
      vectorSimilarity: 0.5,
      queryTags: [
        'context:auth', // namespace 'context'
        'domain:auth', // namespace 'domain'
        'domain:api', // namespace 'domain' (won't match)
        'applies-to:User', // namespace 'applies-to'
        'methodology:v-model', // namespace 'methodology'
        'other', // unnamespaced
      ],
      unit,
    });

    expect(features.tagOverlapContext).toBe(1); // 1/1 context-ns query tags matched
    expect(features.tagOverlapDomain).toBe(0.5); // 1/2 domain-ns query tags matched
    expect(features.tagOverlapAppliesTo).toBe(1);
    expect(features.tagOverlapMethodology).toBe(1);
    expect(features.tagOverlapOther).toBe(1);
    expect(features.tagOverlapAll).toBeCloseTo(5 / 6); // 5 of 6 total match
  });

  it('contentTypePreferred is binary', () => {
    const unit = makeUnit({ metadata: { ...makeUnit().metadata, contentType: 'rule' } });
    const matched = extractFeatures({
      vectorSimilarity: 0.5,
      queryTags: [],
      queryContentTypes: ['rule', 'fact'],
      unit,
    });
    expect(matched.contentTypePreferred).toBe(1);

    const notMatched = extractFeatures({
      vectorSimilarity: 0.5,
      queryTags: [],
      queryContentTypes: ['instruction'],
      unit,
    });
    expect(notMatched.contentTypePreferred).toBe(0);
  });

  it('usage prior is log-compressed', () => {
    const unit = makeUnit({
      usage: { retrievalCount: 100, inclusionCount: 0, outcomeSignals: [] },
    });
    const f = extractFeatures({ vectorSimilarity: 0.5, queryTags: [], unit });
    expect(f.usagePrior).toBeGreaterThan(0);
    expect(f.usagePrior).toBeLessThanOrEqual(1);
  });

  it('outcome prior reflects positive/negative balance', () => {
    const baseline = extractFeatures({
      vectorSimilarity: 0.5,
      queryTags: [],
      unit: makeUnit(),
    });
    expect(baseline.outcomePrior).toBe(0);

    const positive = extractFeatures({
      vectorSimilarity: 0.5,
      queryTags: [],
      unit: makeUnit({
        usage: {
          retrievalCount: 0,
          inclusionCount: 0,
          outcomeSignals: [
            { timestamp: 0, type: 'positive', source: 't' },
            { timestamp: 0, type: 'positive', source: 't' },
          ],
        },
      }),
    });
    expect(positive.outcomePrior).toBeGreaterThan(0);

    const negative = extractFeatures({
      vectorSimilarity: 0.5,
      queryTags: [],
      unit: makeUnit({
        usage: {
          retrievalCount: 0,
          inclusionCount: 0,
          outcomeSignals: [
            { timestamp: 0, type: 'negative', source: 't' },
            { timestamp: 0, type: 'negative', source: 't' },
          ],
        },
      }),
    });
    expect(negative.outcomePrior).toBeLessThan(0);
  });
});

// ── Feature-based scoring ──────────────────────────────────────────────────

describe('scoreFromFeatures', () => {
  it('score is linear combination of feature * weight', () => {
    const features = extractFeatures({
      vectorSimilarity: 0.8,
      queryTags: [],
      unit: makeUnit(),
    });

    const weights = { vectorSimilarity: 1.0 };
    const score = scoreFromFeatures(features, weights);
    expect(score).toBeCloseTo(0.8);
  });

  it('missing weights contribute nothing', () => {
    const features = extractFeatures({
      vectorSimilarity: 0.5,
      queryTags: [],
      unit: makeUnit(),
    });

    // Use only vectorSimilarity weight; others absent
    const score = scoreFromFeatures(features, { vectorSimilarity: 2.0 });
    expect(score).toBe(1.0); // 2 * 0.5 = 1
  });

  it('DEFAULT_WEIGHTS produces sane scores', () => {
    const unit = makeUnit({
      metadata: { ...makeUnit().metadata, tags: ['domain:auth'] },
    });
    const features = extractFeatures({
      vectorSimilarity: 0.7,
      queryTags: ['domain:auth'],
      unit,
    });
    const score = scoreFromFeatures(features, DEFAULT_WEIGHTS);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(2); // Rough sanity
  });

  it('FEATURE_NAMES covers all feature keys', () => {
    const features = extractFeatures({
      vectorSimilarity: 0.5,
      queryTags: [],
      unit: makeUnit(),
    });
    const keys = Object.keys(features);
    for (const k of keys) {
      expect(FEATURE_NAMES).toContain(k as any);
    }
    expect(FEATURE_NAMES).toHaveLength(keys.length);
  });

  it('WEIGHTS_VECTOR_ONLY behaves like pure vector', () => {
    const unit = makeUnit({
      metadata: { ...makeUnit().metadata, tags: ['domain:auth', 'methodology:bdd'] },
    });
    const features = extractFeatures({
      vectorSimilarity: 0.6,
      queryTags: ['domain:auth', 'methodology:bdd'],
      unit,
    });
    const score = scoreFromFeatures(features, WEIGHTS_VECTOR_ONLY);
    expect(score).toBeCloseTo(0.6); // Only vector contributes
  });
});

// ── FeatureRetriever ───────────────────────────────────────────────────────

describe('FeatureRetriever', () => {
  it('retrieves and rescores with default weights', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });
    await oc.acquire('Authentication uses JWT', ctx.id, {
      tags: ['domain:auth'],
    });
    await oc.acquire('Database is PostgreSQL', ctx.id, {
      tags: ['domain:database'],
    });

    const retriever = new FeatureRetriever({
      embedder: oc.embedder,
      vectorStore: oc.vectorStore,
      unitStore: oc.unitStore,
      contextStore: oc.contextStore,
      scopeResolver: oc.scopeResolver,
    });

    const result = await retriever.retrieve('authentication', {
      contextId: ctx.id,
      maxResults: 10,
      queryTags: ['domain:auth'],
    });

    expect(result.units.length).toBeGreaterThan(0);
    const top = result.units[0];
    expect(top.unit.content).toContain('Authentication');
  });

  it('setWeights updates the scoring function', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });
    await oc.acquire('Similar content X', ctx.id, {
      tags: ['domain:auth', 'methodology:bdd'],
    });
    await oc.acquire('Similar content Y', ctx.id, { tags: ['domain:frontend'] });

    const retriever = new FeatureRetriever({
      embedder: oc.embedder,
      vectorStore: oc.vectorStore,
      unitStore: oc.unitStore,
      contextStore: oc.contextStore,
      scopeResolver: oc.scopeResolver,
    });

    // With tag-heavy weights, tag-matched unit should score higher
    retriever.setWeights(WEIGHTS_TAG_HEAVY);
    const tagHeavy = await retriever.retrieve('content', {
      contextId: ctx.id,
      maxResults: 10,
      queryTags: ['domain:auth', 'methodology:bdd'],
    });
    const authRank = tagHeavy.units.findIndex((su) =>
      su.unit.metadata.tags.includes('domain:auth'),
    );
    const frontendRank = tagHeavy.units.findIndex((su) =>
      su.unit.metadata.tags.includes('domain:frontend'),
    );
    expect(authRank).toBeLessThan(frontendRank); // auth ranked higher

    // Switch to vector-only weights — same similarity, so ordering is tie/arbitrary
    retriever.setWeights(WEIGHTS_VECTOR_ONLY);
    const vectorOnly = await retriever.retrieve('content', {
      contextId: ctx.id,
      maxResults: 10,
      queryTags: ['domain:auth', 'methodology:bdd'],
    });
    // Both should be returned, scores should be similar (pure vector sim)
    expect(vectorOnly.units.length).toBe(2);
    const scoreSpread =
      Math.abs(vectorOnly.units[0].score - vectorOnly.units[1].score);
    expect(scoreSpread).toBeLessThan(0.3); // Similar scores — tag boost gone
  });

  it('extractFeaturesForQuery returns candidate features for training', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });
    await oc.acquire('Unit A', ctx.id);
    await oc.acquire('Unit B', ctx.id);

    const retriever = new FeatureRetriever({
      embedder: oc.embedder,
      vectorStore: oc.vectorStore,
      unitStore: oc.unitStore,
      contextStore: oc.contextStore,
      scopeResolver: oc.scopeResolver,
    });

    const pairs = await retriever.extractFeaturesForQuery('query text', {
      contextId: ctx.id,
      maxResults: 10,
      queryTags: [],
    });
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.unit).toBeDefined();
      expect(p.features.vectorSimilarity).toBeGreaterThanOrEqual(0);
      expect(p.features.vectorSimilarity).toBeLessThanOrEqual(1);
    }
  });
});

// ── Training data store ────────────────────────────────────────────────────

describe('InMemoryTrainingDataStore', () => {
  function makeExample(
    source: TrainingExample['source'] = 'benchmark-judgment',
  ): TrainingExample {
    return {
      id: `ex-${Math.random()}`,
      query: 'test query',
      queryTags: ['domain:test'],
      contextId: 'ctx-1',
      features: {
        vectorSimilarity: 0.7,
        tagOverlapAll: 0.5,
        tagOverlapContext: 0,
        tagOverlapDomain: 1,
        tagOverlapAppliesTo: 0,
        tagOverlapMethodology: 0,
        tagOverlapOther: 0,
        contentTypePreferred: 1,
        sourceIsSystem: 0,
        usagePrior: 0,
        outcomePrior: 0,
      },
      label: 'relevant',
      relevanceScore: 1.0,
      source,
      unitId: 'u1',
      timestamp: Date.now(),
    };
  }

  it('records and retrieves examples', async () => {
    const store = new InMemoryTrainingDataStore();
    await store.record(makeExample('benchmark-judgment'));
    await store.record(makeExample('agent-used'));

    const all = await store.getAll();
    expect(all).toHaveLength(2);
  });

  it('filters by source', async () => {
    const store = new InMemoryTrainingDataStore();
    await store.recordBatch([
      makeExample('benchmark-judgment'),
      makeExample('benchmark-judgment'),
      makeExample('agent-used'),
    ]);

    const benchmark = await store.getAll({ source: 'benchmark-judgment' });
    expect(benchmark).toHaveLength(2);

    const agent = await store.getAll({ source: 'agent-used' });
    expect(agent).toHaveLength(1);
  });

  it('counts by source', async () => {
    const store = new InMemoryTrainingDataStore();
    await store.recordBatch([
      makeExample('benchmark-judgment'),
      makeExample('agent-used'),
      makeExample('agent-used'),
      makeExample('agent-unused'),
    ]);

    const counts = await store.counts();
    expect(counts['benchmark-judgment']).toBe(1);
    expect(counts['agent-used']).toBe(2);
    expect(counts['agent-unused']).toBe(1);
    expect(counts['agent-follow-up']).toBe(0);
  });

  it('relevanceLevelToLabel maps correctly', () => {
    expect(relevanceLevelToLabel('essential')).toEqual({ label: 'relevant', score: 1.0 });
    expect(relevanceLevelToLabel('helpful').label).toBe('relevant');
    expect(relevanceLevelToLabel('tangential').label).toBe('relevant');
    expect(relevanceLevelToLabel('irrelevant').label).toBe('irrelevant');
  });
});
