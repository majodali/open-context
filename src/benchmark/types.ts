/**
 * Retrieval Benchmark Types
 *
 * The benchmark evaluates retrieval strategies against a corpus with
 * known relevance judgments. Used for:
 * - Validating that hierarchical and tag-aware retrieval outperform flat
 *   vector retrieval at meaningful scales
 * - Comparing strategies head-to-head when changes are proposed
 * - Tracking retrieval quality over time as the system evolves
 *
 * Stable corpus IDs (rather than UUIDs) let benchmarks be reproducible
 * across different OpenContext instances. The harness maps corpus IDs to
 * runtime UUIDs when seeding.
 */

import type { ContentType, RetrievalOptions } from '../core/types.js';

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

/**
 * A benchmark corpus: hierarchy + units with stable corpus IDs.
 * The same corpus can be loaded into different OpenContext instances
 * for comparable benchmark runs.
 */
export interface BenchmarkCorpus {
  /** Unique name for the corpus (e.g., 'sdlc-saas-todo'). */
  name: string;
  /** Description of what the corpus represents. */
  description: string;
  /** Bounded contexts in the corpus. */
  contexts: BenchmarkContext[];
  /** Knowledge units. */
  units: BenchmarkUnit[];
}

export interface BenchmarkContext {
  /** Stable ID within the corpus (e.g., 'root', 'auth', 'api'). */
  id: string;
  name: string;
  description: string;
  /** Parent context ID (must refer to another BenchmarkContext.id). */
  parentId?: string;
}

export interface BenchmarkUnit {
  /** Stable ID within the corpus, used by judgments. */
  corpusId: string;
  /** Refers to a BenchmarkContext.id. */
  contextId: string;
  content: string;
  contentType: ContentType;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Queries and Relevance Judgments
// ---------------------------------------------------------------------------

/**
 * Categories of queries — each tests different aspects of retrieval.
 * - direct: query closely matches a unit's text (basic vector retrieval test)
 * - conceptual: query is semantically related but uses different vocabulary
 *   (tests embedding quality)
 * - cross-context: query is from one context but relevant content lives elsewhere
 *   (tests hierarchical/tag retrieval)
 * - methodological: abstract "how should I" queries needing rules/principles
 *   (tests whether methodology surfaces for domain tasks)
 */
export type QueryCategory =
  | 'direct'
  | 'conceptual'
  | 'cross-context'
  | 'methodological';

/**
 * Relevance levels for graded relevance judgments.
 * Numeric weights (used for nDCG):
 *   essential = 3, helpful = 2, tangential = 1, irrelevant = 0
 */
export type RelevanceLevel = 'essential' | 'helpful' | 'tangential' | 'irrelevant';

export const RELEVANCE_WEIGHTS: Record<RelevanceLevel, number> = {
  essential: 3,
  helpful: 2,
  tangential: 1,
  irrelevant: 0,
};

export interface RelevanceJudgment {
  /** Unit corpus ID. */
  corpusId: string;
  relevance: RelevanceLevel;
  /** Optional rationale for the judgment. */
  rationale?: string;
}

export interface BenchmarkQuery {
  id: string;
  text: string;
  /** Context ID the query is "from" (affects hierarchical scope weighting). */
  fromContextId: string;
  /** Optional tags for tag-aware retrieval. */
  queryTags?: string[];
  category: QueryCategory;
  /** Relevance judgments for units in the corpus. */
  judgments: RelevanceJudgment[];
  /** Optional description of what the query tests. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Evaluation Suite
// ---------------------------------------------------------------------------

/**
 * A complete evaluation suite: a corpus paired with a set of queries
 * with known relevance judgments.
 */
export interface EvaluationSuite {
  name: string;
  description: string;
  corpus: BenchmarkCorpus;
  queries: BenchmarkQuery[];
}

// ---------------------------------------------------------------------------
// Retrieval Strategies
// ---------------------------------------------------------------------------

/**
 * A named retrieval strategy with its configuration.
 * Strategies are applied to the same corpus + queries for direct comparison.
 *
 * Two modes:
 * - Default: strategy configures RetrievalOptions and the benchmark runs the
 *   standard OpenContext retriever with those options.
 * - Custom: strategy provides its own retrieve function, which is useful when
 *   testing an alternative retriever (e.g., FeatureRetriever) against the
 *   same corpus and queries.
 */
export interface RetrievalStrategy {
  /** Strategy name (e.g., 'flat-vector', 'hierarchical', 'tag-aware', 'combined'). */
  name: string;
  /** Description of what this strategy tests. */
  description: string;
  /**
   * Function that builds retrieval options for a given query.
   * Lets a strategy use query-specific information (like queryTags from the
   * query definition) when configuring retrieval.
   */
  buildOptions(query: BenchmarkQuery, baseOptions: RetrievalOptions): RetrievalOptions;
  /**
   * Optional custom retrieve function. If provided, the benchmark calls this
   * instead of the default OpenContext retriever. Use when the strategy
   * implements its own retriever (e.g., FeatureRetriever).
   *
   * The BenchmarkContext passed gives access to the loaded OpenContext instance.
   */
  retrieve?(
    query: BenchmarkQuery,
    options: RetrievalOptions,
    context: { openContext: import('../index.js').OpenContext },
  ): Promise<{ units: import('../core/types.js').ScoredUnit[] }>;
}

// ---------------------------------------------------------------------------
// Run Results
// ---------------------------------------------------------------------------

/** Result of running one query under one strategy. */
export interface QueryRunResult {
  queryId: string;
  category: QueryCategory;
  /** Retrieved units in rank order. */
  retrieved: RetrievedUnit[];
  /** Per-query metrics. */
  metrics: QueryMetrics;
  /** Time taken for this query. */
  durationMs: number;
}

export interface RetrievedUnit {
  corpusId: string;
  rank: number; // 1-indexed
  score: number;
  /** Did the judgments include this unit? */
  judgedRelevance: RelevanceLevel | 'unjudged';
}

export interface QueryMetrics {
  /** Precision at k for several k values. */
  precisionAtK: Record<number, number>;
  /** Recall at k for several k values. */
  recallAtK: Record<number, number>;
  /** Mean Reciprocal Rank (rank of first relevant result). */
  mrr: number;
  /** Normalized Discounted Cumulative Gain at k. */
  ndcg: Record<number, number>;
  /** How many essential units were retrieved (any rank). */
  essentialRetrieved: number;
  /** How many essential units were missed entirely. */
  essentialMissed: number;
  /** Total essential units in the judgments. */
  totalEssential: number;
  /** Total relevant (any level) units in the judgments. */
  totalRelevant: number;
}

/** Result of running all queries under one strategy. */
export interface StrategyRunResult {
  strategyName: string;
  queryResults: QueryRunResult[];
  metrics: AggregateMetrics;
  totalDurationMs: number;
}

export interface AggregateMetrics {
  meanPrecisionAtK: Record<number, number>;
  meanRecallAtK: Record<number, number>;
  meanMRR: number;
  meanNDCG: Record<number, number>;
  /** Fraction of queries where all essential units were retrieved. */
  essentialCoverageRate: number;
  /** Aggregate metrics broken down by query category. */
  byCategory: Record<QueryCategory, CategoryMetrics>;
  totalQueries: number;
}

export interface CategoryMetrics {
  count: number;
  meanPrecisionAtK: Record<number, number>;
  meanRecallAtK: Record<number, number>;
  meanMRR: number;
  meanNDCG: Record<number, number>;
  essentialCoverageRate: number;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Side-by-side comparison of multiple strategy results. */
export interface BenchmarkComparison {
  suiteName: string;
  results: StrategyRunResult[];
  /** Strategy comparisons against a baseline. */
  comparisons: StrategyComparison[];
  generatedAt: number;
}

export interface StrategyComparison {
  baselineStrategy: string;
  candidateStrategy: string;
  /** Delta in mean MRR (candidate - baseline). Positive means candidate better. */
  mrrDelta: number;
  ndcgDeltaAt10: number;
  precisionDeltaAt5: number;
  recallDeltaAt10: number;
  essentialCoverageDelta: number;
  /** Number of queries where candidate strictly outperformed baseline (in nDCG@10). */
  queriesImproved: number;
  /** Number where candidate was strictly worse. */
  queriesRegressed: number;
  /** Number where they tied. */
  queriesTied: number;
  /** Per-category delta in mean nDCG@10. */
  byCategoryNdcgDelta: Record<QueryCategory, number>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BenchmarkRunnerConfig {
  /** k values for precision@k, recall@k, nDCG@k. Default: [1, 3, 5, 10]. */
  kValues: number[];
  /** Maximum results to retrieve per query. Default: 20. */
  maxResults: number;
}

export const DEFAULT_BENCHMARK_CONFIG: BenchmarkRunnerConfig = {
  kValues: [1, 3, 5, 10],
  maxResults: 20,
};
