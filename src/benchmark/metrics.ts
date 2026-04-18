/**
 * Information Retrieval Metrics
 *
 * Standard metrics adapted for OpenContext's graded relevance:
 * - Precision@k: fraction of top-k that are relevant
 * - Recall@k: fraction of relevant units found in top-k
 * - MRR: mean reciprocal rank of the first relevant result
 * - nDCG@k: normalized discounted cumulative gain (graded relevance)
 *
 * For binary metrics (precision, recall, MRR), "relevant" means relevance
 * level >= 'tangential' (i.e., not 'irrelevant').
 *
 * For nDCG, graded weights are used (essential=3, helpful=2, tangential=1).
 */

import type {
  RelevanceLevel,
  RelevanceJudgment,
  RetrievedUnit,
  QueryMetrics,
  AggregateMetrics,
  CategoryMetrics,
  QueryRunResult,
  QueryCategory,
} from './types.js';
import { RELEVANCE_WEIGHTS } from './types.js';

// ---------------------------------------------------------------------------
// Relevance helpers
// ---------------------------------------------------------------------------

/** Is this relevance level "relevant" for binary metrics? */
function isRelevant(level: RelevanceLevel): boolean {
  return level !== 'irrelevant';
}

/** Numeric weight for graded metrics. */
function relevanceWeight(level: RelevanceLevel): number {
  return RELEVANCE_WEIGHTS[level];
}

/** Build a map: corpusId → relevance level from judgments. */
function judgmentMap(judgments: RelevanceJudgment[]): Map<string, RelevanceLevel> {
  const map = new Map<string, RelevanceLevel>();
  for (const j of judgments) {
    map.set(j.corpusId, j.relevance);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Per-query metric computation
// ---------------------------------------------------------------------------

export function computeQueryMetrics(
  retrieved: RetrievedUnit[],
  judgments: RelevanceJudgment[],
  kValues: number[],
): QueryMetrics {
  const judgeMap = judgmentMap(judgments);

  // Annotate retrieved units with their judgment
  const annotated = retrieved.map((r) => ({
    ...r,
    relevance: judgeMap.get(r.corpusId) ?? ('unjudged' as const),
  }));

  // Total relevant counts (any non-irrelevant level)
  const totalEssential = judgments.filter((j) => j.relevance === 'essential').length;
  const totalRelevant = judgments.filter((j) => j.relevance !== 'irrelevant').length;

  // Precision@k and Recall@k
  const precisionAtK: Record<number, number> = {};
  const recallAtK: Record<number, number> = {};

  for (const k of kValues) {
    const topK = annotated.slice(0, k);
    const relevantInTopK = topK.filter((a) => {
      if (a.relevance === 'unjudged') return false;
      return isRelevant(a.relevance as RelevanceLevel);
    }).length;

    // Standard IR: P@k uses k as denominator (not actual returned count).
    // If fewer than k were returned, the "missing" slots count as not-relevant.
    precisionAtK[k] = k > 0 ? relevantInTopK / k : 0;
    recallAtK[k] = totalRelevant > 0 ? relevantInTopK / totalRelevant : 0;
  }

  // MRR — rank of first relevant result
  let mrr = 0;
  for (let i = 0; i < annotated.length; i++) {
    const a = annotated[i];
    if (a.relevance !== 'unjudged' && isRelevant(a.relevance as RelevanceLevel)) {
      mrr = 1 / (i + 1);
      break;
    }
  }

  // nDCG@k — graded relevance
  const ndcg: Record<number, number> = {};
  for (const k of kValues) {
    ndcg[k] = computeNDCG(annotated, judgments, k);
  }

  // Essential coverage
  const essentialRetrievedIds = new Set(
    annotated.filter((a) => a.relevance === 'essential').map((a) => a.corpusId),
  );
  const essentialRetrieved = essentialRetrievedIds.size;
  const essentialMissed = totalEssential - essentialRetrieved;

  return {
    precisionAtK,
    recallAtK,
    mrr,
    ndcg,
    essentialRetrieved,
    essentialMissed,
    totalEssential,
    totalRelevant,
  };
}

/**
 * Normalized Discounted Cumulative Gain at k.
 * DCG@k = sum_{i=1..k} (2^rel_i - 1) / log2(i + 1)
 * nDCG@k = DCG@k / IDCG@k (where IDCG is the perfect ranking's DCG)
 *
 * Returns 0 if there's no relevant content (perfect would be 0 too).
 */
function computeNDCG(
  annotated: { relevance: RelevanceLevel | 'unjudged' }[],
  judgments: RelevanceJudgment[],
  k: number,
): number {
  // DCG@k of the actual ranking
  let dcg = 0;
  for (let i = 0; i < Math.min(k, annotated.length); i++) {
    const rel = annotated[i].relevance === 'unjudged'
      ? 0
      : relevanceWeight(annotated[i].relevance as RelevanceLevel);
    if (rel > 0) {
      dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
    }
  }

  // IDCG@k — DCG of the ideal ranking
  // Ideal: sort all judgments by relevance descending, take top k
  const sortedRelevances = judgments
    .map((j) => relevanceWeight(j.relevance))
    .filter((w) => w > 0)
    .sort((a, b) => b - a)
    .slice(0, k);

  let idcg = 0;
  for (let i = 0; i < sortedRelevances.length; i++) {
    idcg += (Math.pow(2, sortedRelevances[i]) - 1) / Math.log2(i + 2);
  }

  return idcg > 0 ? dcg / idcg : 0;
}

// ---------------------------------------------------------------------------
// Aggregation across queries
// ---------------------------------------------------------------------------

export function aggregateMetrics(
  queryResults: QueryRunResult[],
  kValues: number[],
): AggregateMetrics {
  const total = queryResults.length;
  const meanPrecisionAtK: Record<number, number> = {};
  const meanRecallAtK: Record<number, number> = {};
  const meanNDCG: Record<number, number> = {};

  for (const k of kValues) {
    meanPrecisionAtK[k] = mean(queryResults.map((r) => r.metrics.precisionAtK[k] ?? 0));
    meanRecallAtK[k] = mean(queryResults.map((r) => r.metrics.recallAtK[k] ?? 0));
    meanNDCG[k] = mean(queryResults.map((r) => r.metrics.ndcg[k] ?? 0));
  }

  const meanMRR = mean(queryResults.map((r) => r.metrics.mrr));

  // Essential coverage rate: queries where all essentials were retrieved
  const fullyCovered = queryResults.filter(
    (r) => r.metrics.totalEssential === 0 || r.metrics.essentialMissed === 0,
  ).length;
  const essentialCoverageRate = total > 0 ? fullyCovered / total : 0;

  // Per-category aggregation
  const byCategory = aggregateByCategory(queryResults, kValues);

  return {
    meanPrecisionAtK,
    meanRecallAtK,
    meanMRR,
    meanNDCG,
    essentialCoverageRate,
    byCategory,
    totalQueries: total,
  };
}

function aggregateByCategory(
  queryResults: QueryRunResult[],
  kValues: number[],
): Record<QueryCategory, CategoryMetrics> {
  const categories: QueryCategory[] = ['direct', 'conceptual', 'cross-context', 'methodological'];
  const result = {} as Record<QueryCategory, CategoryMetrics>;

  for (const cat of categories) {
    const catResults = queryResults.filter((r) => r.category === cat);
    if (catResults.length === 0) {
      result[cat] = emptyCategory(kValues);
      continue;
    }

    const meanP: Record<number, number> = {};
    const meanR: Record<number, number> = {};
    const meanN: Record<number, number> = {};
    for (const k of kValues) {
      meanP[k] = mean(catResults.map((r) => r.metrics.precisionAtK[k] ?? 0));
      meanR[k] = mean(catResults.map((r) => r.metrics.recallAtK[k] ?? 0));
      meanN[k] = mean(catResults.map((r) => r.metrics.ndcg[k] ?? 0));
    }

    const fullyCovered = catResults.filter(
      (r) => r.metrics.totalEssential === 0 || r.metrics.essentialMissed === 0,
    ).length;

    result[cat] = {
      count: catResults.length,
      meanPrecisionAtK: meanP,
      meanRecallAtK: meanR,
      meanMRR: mean(catResults.map((r) => r.metrics.mrr)),
      meanNDCG: meanN,
      essentialCoverageRate: fullyCovered / catResults.length,
    };
  }

  return result;
}

function emptyCategory(kValues: number[]): CategoryMetrics {
  const empty: Record<number, number> = {};
  for (const k of kValues) empty[k] = 0;
  return {
    count: 0,
    meanPrecisionAtK: { ...empty },
    meanRecallAtK: { ...empty },
    meanMRR: 0,
    meanNDCG: { ...empty },
    essentialCoverageRate: 0,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
