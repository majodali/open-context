import { describe, it, expect } from 'vitest';
import {
  BenchmarkRunner,
  computeQueryMetrics,
  aggregateMetrics,
  formatBenchmarkComparison,
  FLAT_VECTOR_STRATEGY,
  HIERARCHICAL_STRATEGY,
  tagAwareStrategy,
  DeterministicEmbedder,
} from '../src/index.js';
import type {
  EvaluationSuite,
  RetrievedUnit,
  RelevanceJudgment,
  QueryRunResult,
} from '../src/index.js';

// ── Metrics tests ──────────────────────────────────────────────────────────

describe('Benchmark metrics', () => {
  function makeRetrieved(items: { corpusId: string }[]): RetrievedUnit[] {
    return items.map((it, i) => ({
      corpusId: it.corpusId,
      rank: i + 1,
      score: 1 - i * 0.1,
      judgedRelevance: 'unjudged',
    }));
  }

  it('computeQueryMetrics: perfect retrieval', () => {
    const judgments: RelevanceJudgment[] = [
      { corpusId: 'a', relevance: 'essential' },
      { corpusId: 'b', relevance: 'essential' },
    ];
    const retrieved = makeRetrieved([{ corpusId: 'a' }, { corpusId: 'b' }]);
    const m = computeQueryMetrics(retrieved, judgments, [1, 3, 5, 10]);

    expect(m.precisionAtK[1]).toBe(1);
    expect(m.precisionAtK[3]).toBeCloseTo(2 / 3); // 2 relevant, 3 returned
    expect(m.recallAtK[3]).toBe(1); // both essentials in top 3
    expect(m.mrr).toBe(1); // first result is relevant
    expect(m.essentialRetrieved).toBe(2);
    expect(m.essentialMissed).toBe(0);
  });

  it('computeQueryMetrics: nothing relevant retrieved', () => {
    const judgments: RelevanceJudgment[] = [
      { corpusId: 'a', relevance: 'essential' },
    ];
    const retrieved = makeRetrieved([{ corpusId: 'x' }, { corpusId: 'y' }]);
    const m = computeQueryMetrics(retrieved, judgments, [1, 5, 10]);

    expect(m.precisionAtK[1]).toBe(0);
    expect(m.recallAtK[10]).toBe(0);
    expect(m.mrr).toBe(0);
    expect(m.essentialRetrieved).toBe(0);
    expect(m.essentialMissed).toBe(1);
  });

  it('computeQueryMetrics: MRR reflects rank of first relevant', () => {
    const judgments: RelevanceJudgment[] = [
      { corpusId: 'a', relevance: 'essential' },
    ];
    const retrieved = makeRetrieved([
      { corpusId: 'x' }, // irrelevant
      { corpusId: 'y' }, // irrelevant
      { corpusId: 'a' }, // relevant at rank 3
    ]);
    const m = computeQueryMetrics(retrieved, judgments, [1, 3, 5]);

    expect(m.mrr).toBeCloseTo(1 / 3);
    expect(m.precisionAtK[3]).toBeCloseTo(1 / 3);
  });

  it('nDCG rewards top ranking of essential results', () => {
    const judgments: RelevanceJudgment[] = [
      { corpusId: 'essential1', relevance: 'essential' },
      { corpusId: 'helpful1', relevance: 'helpful' },
    ];
    // Optimal ranking: essential first
    const optimal = makeRetrieved([{ corpusId: 'essential1' }, { corpusId: 'helpful1' }]);
    // Suboptimal: helpful first
    const suboptimal = makeRetrieved([{ corpusId: 'helpful1' }, { corpusId: 'essential1' }]);

    const optMetrics = computeQueryMetrics(optimal, judgments, [10]);
    const subMetrics = computeQueryMetrics(suboptimal, judgments, [10]);

    expect(optMetrics.ndcg[10]).toBe(1); // perfect
    expect(subMetrics.ndcg[10]).toBeLessThan(1);
    expect(subMetrics.ndcg[10]).toBeGreaterThan(0);
  });

  it('aggregateMetrics computes means correctly', () => {
    const queryResults: QueryRunResult[] = [
      {
        queryId: 'q1',
        category: 'direct',
        retrieved: [],
        durationMs: 0,
        metrics: {
          precisionAtK: { 1: 1.0, 5: 0.8 },
          recallAtK: { 1: 0.5, 5: 1.0 },
          mrr: 1.0,
          ndcg: { 1: 1.0, 5: 0.95 },
          essentialRetrieved: 2,
          essentialMissed: 0,
          totalEssential: 2,
          totalRelevant: 4,
        },
      },
      {
        queryId: 'q2',
        category: 'direct',
        retrieved: [],
        durationMs: 0,
        metrics: {
          precisionAtK: { 1: 0.0, 5: 0.4 },
          recallAtK: { 1: 0.0, 5: 0.5 },
          mrr: 0.5,
          ndcg: { 1: 0.0, 5: 0.6 },
          essentialRetrieved: 1,
          essentialMissed: 1,
          totalEssential: 2,
          totalRelevant: 3,
        },
      },
    ];

    const agg = aggregateMetrics(queryResults, [1, 5]);
    expect(agg.meanMRR).toBeCloseTo(0.75);
    expect(agg.meanPrecisionAtK[1]).toBeCloseTo(0.5);
    expect(agg.meanPrecisionAtK[5]).toBeCloseTo(0.6);
    expect(agg.meanNDCG[5]).toBeCloseTo(0.775);
    expect(agg.essentialCoverageRate).toBeCloseTo(0.5); // q1 fully covered, q2 not
    expect(agg.byCategory.direct.count).toBe(2);
  });
});

// ── BenchmarkRunner tests ──────────────────────────────────────────────────

const tinySuite: EvaluationSuite = {
  name: 'tiny-suite',
  description: 'Tiny test suite',
  corpus: {
    name: 'tiny-corpus',
    description: 'Just a few units across 2 contexts',
    contexts: [
      { id: 'root', name: 'Root', description: 'Root' },
      { id: 'child', name: 'Child', description: 'Child', parentId: 'root' },
    ],
    units: [
      {
        corpusId: 'u1',
        contextId: 'root',
        contentType: 'fact',
        tags: ['general'],
        content: 'A fact at root level about apples and oranges',
      },
      {
        corpusId: 'u2',
        contextId: 'child',
        contentType: 'rule',
        tags: ['domain:fruit'],
        content: 'Rules for picking fruit from trees',
      },
      {
        corpusId: 'u3',
        contextId: 'child',
        contentType: 'fact',
        tags: ['domain:fruit'],
        content: 'Apples grow on apple trees in orchards',
      },
    ],
  },
  queries: [
    {
      id: 'q1',
      text: 'Tell me about apple trees and orchards',
      fromContextId: 'child',
      queryTags: ['domain:fruit'],
      category: 'direct',
      judgments: [
        { corpusId: 'u3', relevance: 'essential' },
        { corpusId: 'u2', relevance: 'helpful' },
        { corpusId: 'u1', relevance: 'tangential' },
      ],
    },
    {
      id: 'q2',
      text: 'apples',
      fromContextId: 'root',
      category: 'conceptual',
      judgments: [
        { corpusId: 'u1', relevance: 'essential' },
        { corpusId: 'u3', relevance: 'helpful' },
      ],
    },
  ],
};

describe('BenchmarkRunner', () => {
  it('loads suite and runs a strategy', async () => {
    const runner = new BenchmarkRunner({ kValues: [1, 3, 5], maxResults: 10 });
    await runner.loadSuite(tinySuite, new DeterministicEmbedder(64));

    const result = await runner.runStrategy(HIERARCHICAL_STRATEGY);
    expect(result.strategyName).toBe('hierarchical');
    expect(result.queryResults).toHaveLength(2);
    expect(result.metrics.totalQueries).toBe(2);
  });

  it('runs multiple strategies', async () => {
    const runner = new BenchmarkRunner({ kValues: [1, 3, 5], maxResults: 10 });
    await runner.loadSuite(tinySuite, new DeterministicEmbedder(64));

    const results = await runner.runStrategies([
      FLAT_VECTOR_STRATEGY,
      HIERARCHICAL_STRATEGY,
      tagAwareStrategy(1.0),
    ]);

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.strategyName)).toEqual([
      'flat-vector',
      'hierarchical',
      'tag-aware-b1',
    ]);
  });

  it('produces comparison report', async () => {
    const runner = new BenchmarkRunner({ kValues: [1, 5, 10], maxResults: 10 });
    await runner.loadSuite(tinySuite, new DeterministicEmbedder(64));

    const results = await runner.runStrategies([
      FLAT_VECTOR_STRATEGY,
      HIERARCHICAL_STRATEGY,
      tagAwareStrategy(1.0),
    ]);

    const comparison = runner.compare(results, 'flat-vector');
    expect(comparison.results).toHaveLength(3);
    expect(comparison.comparisons).toHaveLength(2);
    expect(comparison.comparisons[0].baselineStrategy).toBe('flat-vector');

    const formatted = formatBenchmarkComparison(comparison);
    expect(formatted).toContain('tiny-suite');
    expect(formatted).toContain('flat-vector');
    expect(formatted).toContain('hierarchical');
    expect(formatted).toContain('tag-aware-b1');
    expect(formatted).toContain('MRR');
    expect(formatted).toContain('nDCG@10');
  });

  it('throws when comparing without loaded suite', async () => {
    const runner = new BenchmarkRunner();
    await expect(runner.runStrategy(HIERARCHICAL_STRATEGY)).rejects.toThrow(/loadSuite/);
  });

  it('throws when comparing with unknown baseline', async () => {
    const runner = new BenchmarkRunner();
    await runner.loadSuite(tinySuite, new DeterministicEmbedder(64));
    const results = await runner.runStrategies([HIERARCHICAL_STRATEGY]);
    expect(() => runner.compare(results, 'nonexistent')).toThrow(/not in results/);
  });
});

// ── SDLC suite tests ───────────────────────────────────────────────────────

describe('SDLC evaluation suite', () => {
  it('SDLC suite loads and is well-formed', async () => {
    const { SDLC_EVALUATION_SUITE } = await import('../src/benchmark/sdlc-suite.js');
    const suite = SDLC_EVALUATION_SUITE;

    expect(suite.corpus.units.length).toBeGreaterThan(20);
    expect(suite.queries.length).toBeGreaterThanOrEqual(20);

    // Every judgment references a corpus unit that exists
    const unitIds = new Set(suite.corpus.units.map((u) => u.corpusId));
    for (const q of suite.queries) {
      for (const j of q.judgments) {
        expect(unitIds.has(j.corpusId)).toBe(true);
      }
    }

    // Every query's fromContextId exists
    const contextIds = new Set(suite.corpus.contexts.map((c) => c.id));
    for (const q of suite.queries) {
      expect(contextIds.has(q.fromContextId)).toBe(true);
    }

    // Every unit's contextId exists
    for (const u of suite.corpus.units) {
      expect(contextIds.has(u.contextId)).toBe(true);
    }

    // Coverage of all four categories
    const cats = new Set(suite.queries.map((q) => q.category));
    expect(cats.has('direct')).toBe(true);
    expect(cats.has('conceptual')).toBe(true);
    expect(cats.has('cross-context')).toBe(true);
    expect(cats.has('methodological')).toBe(true);
  });
});
