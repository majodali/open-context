/**
 * Benchmark Runner
 *
 * Loads an evaluation suite into a fresh OpenContext instance, runs each
 * configured strategy against all queries, computes per-query and aggregate
 * metrics, and produces side-by-side comparisons.
 *
 * Usage:
 *   const runner = new BenchmarkRunner(config);
 *   await runner.loadSuite(suite, embedder);
 *   const results = await runner.runStrategies([flatStrategy, hierStrategy, tagStrategy]);
 *   const comparison = runner.compare(results, 'flat-vector');
 */

import type {
  BenchmarkCorpus,
  BenchmarkContext,
  BenchmarkQuery,
  EvaluationSuite,
  RetrievalStrategy,
  QueryRunResult,
  StrategyRunResult,
  RetrievedUnit,
  BenchmarkComparison,
  StrategyComparison,
  BenchmarkRunnerConfig,
  QueryCategory,
} from './types.js';
import { DEFAULT_BENCHMARK_CONFIG } from './types.js';
import { computeQueryMetrics, aggregateMetrics } from './metrics.js';
import { OpenContext } from '../index.js';
import type { Embedder } from '../storage/embedder.js';
import type { RetrievalOptions } from '../core/types.js';

// ---------------------------------------------------------------------------
// Built-in retrieval strategies
// ---------------------------------------------------------------------------

/** Pure flat vector retrieval — no hierarchy, no tags. The baseline. */
export const FLAT_VECTOR_STRATEGY: RetrievalStrategy = {
  name: 'flat-vector',
  description: 'Pure vector similarity, no hierarchical weighting, no tag boost',
  buildOptions(_query, base) {
    return { ...base, flatScope: true, tagBoostFactor: 0 };
  },
};

/** Hierarchical weighted retrieval (current default OpenContext behavior). */
export const HIERARCHICAL_STRATEGY: RetrievalStrategy = {
  name: 'hierarchical',
  description: 'Vector × scope weight (hierarchical traversal)',
  buildOptions(_query, base) {
    return { ...base, flatScope: false, tagBoostFactor: 0 };
  },
};

/** Tag-aware retrieval — uses query tags from the benchmark query. */
export function tagAwareStrategy(boostFactor: number = 1.0): RetrievalStrategy {
  return {
    name: `tag-aware-b${boostFactor}`,
    description: `Vector × scope × (1 + ${boostFactor} × tag overlap)`,
    buildOptions(query, base) {
      return {
        ...base,
        flatScope: false,
        tagBoostFactor: boostFactor,
        queryTags: query.queryTags ?? [],
      };
    },
  };
}

/**
 * Feature-based retrieval strategy using FeatureRetriever with configurable
 * weight vector. Instantiates a fresh retriever per benchmark call but shares
 * the loaded OpenContext instance's stores.
 */
export function featureBasedStrategy(options?: {
  name?: string;
  weights?: import('../retrieval/feature-scorer.js').WeightVector;
}): RetrievalStrategy {
  const name = options?.name ?? 'feature-based';
  return {
    name,
    description: `Feature-based scoring (${name})`,
    buildOptions(query, base) {
      return { ...base, queryTags: query.queryTags ?? [] };
    },
    async retrieve(query, opts, context) {
      // Build feature retriever on demand using the loaded instance's stores.
      const { FeatureRetriever } = await import('../retrieval/feature-retriever.js');
      const retriever = new FeatureRetriever(
        {
          embedder: context.openContext.embedder,
          vectorStore: context.openContext.vectorStore,
          unitStore: context.openContext.unitStore,
          contextStore: context.openContext.contextStore,
          scopeResolver: context.openContext.scopeResolver,
        },
        { weights: options?.weights },
      );
      const result = await retriever.retrieve(query.text, opts);
      return { units: result.units };
    },
  };
}

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------

export class BenchmarkRunner {
  private oc?: OpenContext;
  private suite?: EvaluationSuite;
  /** Map: corpus context ID → runtime UUID */
  private contextIdMap = new Map<string, string>();
  /** Map: corpus unit ID → runtime UUID */
  private unitIdMap = new Map<string, string>();
  /** Reverse map: runtime UUID → corpus unit ID (for converting results) */
  private unitIdReverseMap = new Map<string, string>();
  private config: BenchmarkRunnerConfig;

  constructor(config?: Partial<BenchmarkRunnerConfig>) {
    this.config = { ...DEFAULT_BENCHMARK_CONFIG, ...config };
  }

  /**
   * Load an evaluation suite into a fresh OpenContext instance.
   * The corpus is seeded; queries are stored for later runs.
   */
  async loadSuite(suite: EvaluationSuite, embedder: Embedder): Promise<void> {
    this.suite = suite;
    this.oc = new OpenContext({ embedder });
    this.contextIdMap.clear();
    this.unitIdMap.clear();
    this.unitIdReverseMap.clear();

    await this.seedCorpus(suite.corpus);
  }

  /**
   * Get the underlying OpenContext instance (for advanced inspection).
   */
  getOpenContext(): OpenContext | undefined {
    return this.oc;
  }

  /**
   * Run a single strategy against all queries and compute metrics.
   */
  async runStrategy(strategy: RetrievalStrategy): Promise<StrategyRunResult> {
    if (!this.oc || !this.suite) {
      throw new Error('No suite loaded — call loadSuite() first');
    }

    const startTime = Date.now();
    const queryResults: QueryRunResult[] = [];

    for (const query of this.suite.queries) {
      const queryResult = await this.runQuery(query, strategy);
      queryResults.push(queryResult);
    }

    const metrics = aggregateMetrics(queryResults, this.config.kValues);

    return {
      strategyName: strategy.name,
      queryResults,
      metrics,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Run multiple strategies sequentially.
   */
  async runStrategies(strategies: RetrievalStrategy[]): Promise<StrategyRunResult[]> {
    const results: StrategyRunResult[] = [];
    for (const strategy of strategies) {
      results.push(await this.runStrategy(strategy));
    }
    return results;
  }

  /**
   * Compare strategy results pairwise against a baseline.
   */
  compare(
    results: StrategyRunResult[],
    baselineName: string,
  ): BenchmarkComparison {
    if (!this.suite) {
      throw new Error('No suite loaded');
    }

    const baseline = results.find((r) => r.strategyName === baselineName);
    if (!baseline) {
      throw new Error(`Baseline strategy '${baselineName}' not in results`);
    }

    const comparisons: StrategyComparison[] = [];
    for (const candidate of results) {
      if (candidate.strategyName === baselineName) continue;
      comparisons.push(this.compareStrategies(baseline, candidate));
    }

    return {
      suiteName: this.suite.name,
      results,
      comparisons,
      generatedAt: Date.now(),
    };
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async seedCorpus(corpus: BenchmarkCorpus): Promise<void> {
    if (!this.oc) throw new Error('No OpenContext instance');

    // Create contexts in dependency order (parents before children)
    const sortedContexts = this.topoSortContexts(corpus.contexts);
    for (const bc of sortedContexts) {
      const parentId = bc.parentId ? this.contextIdMap.get(bc.parentId) : undefined;
      const ctx = await this.oc.createContext({
        name: bc.name,
        description: bc.description,
        parentId,
        metadata: {},
      });
      this.contextIdMap.set(bc.id, ctx.id);
    }

    // Acquire each unit
    for (const bu of corpus.units) {
      const ctxId = this.contextIdMap.get(bu.contextId);
      if (!ctxId) {
        throw new Error(`Unit '${bu.corpusId}' references unknown context '${bu.contextId}'`);
      }

      const units = await this.oc.acquire(bu.content, ctxId, {
        contentType: bu.contentType,
        tags: [...bu.tags, `corpus-id:${bu.corpusId}`],
        sourceType: 'system',
      });
      // Store mapping from corpusId to first acquired unit's UUID.
      // (Acquisition typically produces one unit unless content is large.)
      if (units.length > 0) {
        const runtimeId = units[0].id;
        this.unitIdMap.set(bu.corpusId, runtimeId);
        this.unitIdReverseMap.set(runtimeId, bu.corpusId);
        // Also map any additional chunks
        for (let i = 1; i < units.length; i++) {
          this.unitIdReverseMap.set(units[i].id, bu.corpusId);
        }
      }
    }
  }

  private topoSortContexts(contexts: BenchmarkContext[]): BenchmarkContext[] {
    const sorted: BenchmarkContext[] = [];
    const placed = new Set<string>();

    while (sorted.length < contexts.length) {
      const before = sorted.length;
      for (const c of contexts) {
        if (placed.has(c.id)) continue;
        if (!c.parentId || placed.has(c.parentId)) {
          sorted.push(c);
          placed.add(c.id);
        }
      }
      if (sorted.length === before) {
        throw new Error('Cycle in context hierarchy');
      }
    }

    return sorted;
  }

  private async runQuery(
    query: BenchmarkQuery,
    strategy: RetrievalStrategy,
  ): Promise<QueryRunResult> {
    if (!this.oc) throw new Error('No OpenContext instance');

    const fromContextRuntimeId = this.contextIdMap.get(query.fromContextId);
    if (!fromContextRuntimeId) {
      throw new Error(
        `Query '${query.id}' references unknown context '${query.fromContextId}'`,
      );
    }

    const baseOptions: RetrievalOptions = {
      contextId: fromContextRuntimeId,
      maxResults: this.config.maxResults,
    };
    const options = strategy.buildOptions(query, baseOptions);

    const startTime = Date.now();
    let resultUnits: import('../core/types.js').ScoredUnit[];
    if (strategy.retrieve) {
      // Custom retriever (e.g., FeatureRetriever)
      const custom = await strategy.retrieve(query, options, { openContext: this.oc });
      resultUnits = custom.units;
    } else {
      // Default OpenContext retriever
      const result = await this.oc.retrieve(query.text, fromContextRuntimeId, options);
      resultUnits = result.units;
    }
    const durationMs = Date.now() - startTime;

    // Convert runtime UUIDs back to corpus IDs
    const judgeMap = new Map<string, string>();
    for (const j of query.judgments) {
      judgeMap.set(j.corpusId, j.relevance);
    }

    const retrieved: RetrievedUnit[] = [];
    for (let i = 0; i < resultUnits.length; i++) {
      const su = resultUnits[i];
      const corpusId = this.unitIdReverseMap.get(su.unit.id);
      if (!corpusId) continue; // Skip units we can't map (shouldn't happen)
      retrieved.push({
        corpusId,
        rank: i + 1,
        score: su.score,
        judgedRelevance: (judgeMap.get(corpusId) as any) ?? 'unjudged',
      });
    }

    const metrics = computeQueryMetrics(retrieved, query.judgments, this.config.kValues);

    return {
      queryId: query.id,
      category: query.category,
      retrieved,
      metrics,
      durationMs,
    };
  }

  private compareStrategies(
    baseline: StrategyRunResult,
    candidate: StrategyRunResult,
  ): StrategyComparison {
    // Per-query nDCG@10 deltas
    let queriesImproved = 0;
    let queriesRegressed = 0;
    let queriesTied = 0;

    const baselineQueries = new Map(baseline.queryResults.map((q) => [q.queryId, q]));
    for (const cq of candidate.queryResults) {
      const bq = baselineQueries.get(cq.queryId);
      if (!bq) continue;
      const cNdcg = cq.metrics.ndcg[10] ?? 0;
      const bNdcg = bq.metrics.ndcg[10] ?? 0;
      if (cNdcg > bNdcg + 0.001) queriesImproved++;
      else if (cNdcg < bNdcg - 0.001) queriesRegressed++;
      else queriesTied++;
    }

    // Per-category nDCG@10 delta
    const byCategoryNdcgDelta = {} as Record<QueryCategory, number>;
    const cats: QueryCategory[] = ['direct', 'conceptual', 'cross-context', 'methodological'];
    for (const cat of cats) {
      const cMetric = candidate.metrics.byCategory[cat]?.meanNDCG[10] ?? 0;
      const bMetric = baseline.metrics.byCategory[cat]?.meanNDCG[10] ?? 0;
      byCategoryNdcgDelta[cat] = cMetric - bMetric;
    }

    return {
      baselineStrategy: baseline.strategyName,
      candidateStrategy: candidate.strategyName,
      mrrDelta: candidate.metrics.meanMRR - baseline.metrics.meanMRR,
      ndcgDeltaAt10:
        (candidate.metrics.meanNDCG[10] ?? 0) - (baseline.metrics.meanNDCG[10] ?? 0),
      precisionDeltaAt5:
        (candidate.metrics.meanPrecisionAtK[5] ?? 0) -
        (baseline.metrics.meanPrecisionAtK[5] ?? 0),
      recallDeltaAt10:
        (candidate.metrics.meanRecallAtK[10] ?? 0) -
        (baseline.metrics.meanRecallAtK[10] ?? 0),
      essentialCoverageDelta:
        candidate.metrics.essentialCoverageRate - baseline.metrics.essentialCoverageRate,
      queriesImproved,
      queriesRegressed,
      queriesTied,
      byCategoryNdcgDelta,
    };
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Format a benchmark comparison as a human-readable text report.
 */
export function formatBenchmarkComparison(comparison: BenchmarkComparison): string {
  const lines: string[] = [];
  lines.push(`Benchmark: ${comparison.suiteName}`);
  lines.push(`Generated: ${new Date(comparison.generatedAt).toISOString()}`);
  lines.push('');

  // Strategy results table
  lines.push('Strategy Results');
  lines.push('─'.repeat(80));
  const header = pad('Strategy', 28) + pad('MRR', 8) + pad('nDCG@10', 10) +
    pad('P@5', 8) + pad('R@10', 8) + pad('Coverage', 12) + pad('Time(ms)', 10);
  lines.push(header);
  lines.push('─'.repeat(80));

  for (const r of comparison.results) {
    lines.push(
      pad(r.strategyName, 28) +
      pad(r.metrics.meanMRR.toFixed(3), 8) +
      pad((r.metrics.meanNDCG[10] ?? 0).toFixed(3), 10) +
      pad((r.metrics.meanPrecisionAtK[5] ?? 0).toFixed(3), 8) +
      pad((r.metrics.meanRecallAtK[10] ?? 0).toFixed(3), 8) +
      pad(`${(r.metrics.essentialCoverageRate * 100).toFixed(0)}%`, 12) +
      pad(String(r.totalDurationMs), 10),
    );
  }
  lines.push('');

  // Per-category breakdown for first result (typically baseline)
  if (comparison.results.length > 0) {
    lines.push('Per-Category nDCG@10');
    lines.push('─'.repeat(80));
    const catHeader = pad('Strategy', 28);
    const cats: QueryCategory[] = ['direct', 'conceptual', 'cross-context', 'methodological'];
    let catLine = catHeader;
    for (const c of cats) catLine += pad(c, 14);
    lines.push(catLine);
    lines.push('─'.repeat(80));
    for (const r of comparison.results) {
      let line = pad(r.strategyName, 28);
      for (const c of cats) {
        const m = r.metrics.byCategory[c]?.meanNDCG[10] ?? 0;
        const count = r.metrics.byCategory[c]?.count ?? 0;
        line += pad(count > 0 ? m.toFixed(3) : '-', 14);
      }
      lines.push(line);
    }
    lines.push('');
  }

  // Comparisons against baseline
  if (comparison.comparisons.length > 0) {
    const baseline = comparison.comparisons[0].baselineStrategy;
    lines.push(`Comparisons vs. ${baseline}`);
    lines.push('─'.repeat(80));
    for (const cmp of comparison.comparisons) {
      lines.push(`  ${cmp.candidateStrategy}:`);
      lines.push(`    MRR delta:        ${formatDelta(cmp.mrrDelta)}`);
      lines.push(`    nDCG@10 delta:    ${formatDelta(cmp.ndcgDeltaAt10)}`);
      lines.push(`    P@5 delta:        ${formatDelta(cmp.precisionDeltaAt5)}`);
      lines.push(`    R@10 delta:       ${formatDelta(cmp.recallDeltaAt10)}`);
      lines.push(`    Coverage delta:   ${formatDelta(cmp.essentialCoverageDelta)}`);
      lines.push(
        `    Per query: ${cmp.queriesImproved} improved, ` +
        `${cmp.queriesRegressed} regressed, ${cmp.queriesTied} tied`,
      );
      lines.push(`    Per category nDCG@10:`);
      for (const [cat, delta] of Object.entries(cmp.byCategoryNdcgDelta)) {
        lines.push(`      ${pad(cat, 18)}: ${formatDelta(delta)}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s.substring(0, width - 1) + ' ';
  return s + ' '.repeat(width - s.length);
}

function formatDelta(d: number): string {
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(3)}`;
}
