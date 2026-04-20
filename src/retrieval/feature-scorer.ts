/**
 * Feature-based retrieval scoring.
 *
 * For each (query, candidate-unit) pair, extract a feature vector of observable
 * signals. Combine features with a weight vector to produce a score. The weight
 * vector is a stand-in for what a trained reranker will eventually learn.
 *
 * Today, weights are set heuristically. Tomorrow, they come from a trained
 * model. The feature set and the scoring interface stay the same.
 *
 * Features are designed to be:
 * - Observable: computable from stored data (no hidden state)
 * - Normalized: in [0, 1] where possible, so weights are comparable
 * - Composable: new features can be added without breaking existing ones
 */

import type { SemanticUnit } from '../core/types.js';
import { tagOverlapScore, parseTag } from './tag-overlap.js';

// ---------------------------------------------------------------------------
// Feature vector
// ---------------------------------------------------------------------------

/**
 * Features extracted for a (query, unit) pair.
 * All values are normalized to [0, 1] unless noted.
 */
export interface RetrievalFeatures {
  /** Cosine similarity between query embedding and unit embedding. */
  vectorSimilarity: number;

  // ── Tag-based features ──

  /** Fraction of query tags present on the unit (any match). */
  tagOverlapAll: number;
  /** Fraction of query tags in namespace 'context' or 'ancestor' present on unit. */
  tagOverlapContext: number;
  /** Fraction of query tags in namespace 'domain' present on unit. */
  tagOverlapDomain: number;
  /** Fraction of query tags in namespace 'applies-to' present on unit. */
  tagOverlapAppliesTo: number;
  /** Fraction of query tags in namespace 'methodology' present on unit. */
  tagOverlapMethodology: number;
  /**
   * Overlap for all other namespaces (any namespaced tag not in the above).
   */
  tagOverlapOther: number;

  // ── Content-type features ──

  /** 1.0 if unit's contentType is in the preferred set, else 0. */
  contentTypePreferred: number;

  // ── Source features ──

  /** 1.0 if unit was created by a system source, else 0. */
  sourceIsSystem: number;

  // ── Usage features ──

  /**
   * Usage-based prior: units that have been retrieved/used more tend to be
   * higher quality. Normalized by log(count + 1) / 10 capped at 1.
   */
  usagePrior: number;
  /**
   * Fraction of outcome signals that are positive
   * (positive - negative) / (positive + negative + 1).
   */
  outcomePrior: number;
}

/** Ordered list of feature names — used for consistent weight vector indexing. */
export const FEATURE_NAMES: (keyof RetrievalFeatures)[] = [
  'vectorSimilarity',
  'tagOverlapAll',
  'tagOverlapContext',
  'tagOverlapDomain',
  'tagOverlapAppliesTo',
  'tagOverlapMethodology',
  'tagOverlapOther',
  'contentTypePreferred',
  'sourceIsSystem',
  'usagePrior',
  'outcomePrior',
];

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

export interface FeatureExtractionInput {
  vectorSimilarity: number;
  queryTags: string[];
  queryContentTypes?: string[];
  unit: SemanticUnit;
}

/**
 * Extract the full feature vector for a (query, unit) pair.
 */
export function extractFeatures(input: FeatureExtractionInput): RetrievalFeatures {
  const { vectorSimilarity, queryTags, queryContentTypes, unit } = input;

  // Group query tags by namespace
  const byNamespace = groupTagsByNamespace(queryTags);
  const unitTags = unit.metadata.tags;

  const features: RetrievalFeatures = {
    vectorSimilarity: clamp01(vectorSimilarity),
    tagOverlapAll: tagOverlapScore(queryTags, unitTags),
    tagOverlapContext: namespaceOverlap(
      [...(byNamespace.get('context') ?? []), ...(byNamespace.get('ancestor') ?? [])],
      unitTags,
    ),
    tagOverlapDomain: namespaceOverlap(byNamespace.get('domain') ?? [], unitTags),
    tagOverlapAppliesTo: namespaceOverlap(byNamespace.get('applies-to') ?? [], unitTags),
    tagOverlapMethodology: namespaceOverlap(
      byNamespace.get('methodology') ?? [],
      unitTags,
    ),
    tagOverlapOther: namespaceOverlap(
      flattenRemainingTags(byNamespace, ['context', 'ancestor', 'domain', 'applies-to', 'methodology']),
      unitTags,
    ),
    contentTypePreferred:
      queryContentTypes && queryContentTypes.length > 0
        ? queryContentTypes.includes(unit.metadata.contentType) ? 1 : 0
        : 0,
    sourceIsSystem: unit.metadata.sourceType === 'system' ? 1 : 0,
    usagePrior: computeUsagePrior(unit),
    outcomePrior: computeOutcomePrior(unit),
  };

  return features;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * A weight vector maps feature names to their contribution weights.
 * Weights don't need to sum to 1 — the final score is a linear combination.
 *
 * Default heuristic weights reflect current understanding:
 * - Vector similarity dominates (0.6)
 * - Tag-based features add smaller boosts
 * - Usage/outcome priors are small corrections
 *
 * These are initial guesses, not final values. The benchmark should drive
 * tuning. Eventually, a trained model replaces these with learned weights.
 */
export type WeightVector = Partial<Record<keyof RetrievalFeatures, number>>;

export const DEFAULT_WEIGHTS: WeightVector = {
  vectorSimilarity: 0.6,
  tagOverlapAll: 0.05,
  tagOverlapContext: 0.1,
  tagOverlapDomain: 0.15,
  tagOverlapAppliesTo: 0.2,
  tagOverlapMethodology: 0.15,
  tagOverlapOther: 0.05,
  contentTypePreferred: 0.05,
  sourceIsSystem: 0,
  usagePrior: 0.02,
  outcomePrior: 0.02,
};

/**
 * Compute a score from features + weights.
 * Score = sum over features of weight * feature value.
 */
export function scoreFromFeatures(
  features: RetrievalFeatures,
  weights: WeightVector = DEFAULT_WEIGHTS,
): number {
  let score = 0;
  for (const name of FEATURE_NAMES) {
    const w = weights[name];
    if (w == null) continue;
    score += w * features[name];
  }
  return score;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function groupTagsByNamespace(tags: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const tag of tags) {
    const { namespace } = parseTag(tag);
    const key = namespace ?? '__unnamespaced__';
    const list = map.get(key) ?? [];
    list.push(tag);
    map.set(key, list);
  }
  return map;
}

function namespaceOverlap(queryNsTags: string[], unitTags: string[]): number {
  return tagOverlapScore(queryNsTags, unitTags);
}

function flattenRemainingTags(
  byNamespace: Map<string, string[]>,
  excluded: string[],
): string[] {
  const excludedSet = new Set(excluded);
  const out: string[] = [];
  for (const [ns, tags] of byNamespace) {
    if (excludedSet.has(ns)) continue;
    out.push(...tags);
  }
  return out;
}

function computeUsagePrior(unit: SemanticUnit): number {
  const total = unit.usage.retrievalCount + unit.usage.inclusionCount;
  if (total <= 0) return 0;
  // Log-compress, cap at 1
  return Math.min(1, Math.log10(total + 1) / 2);
}

function computeOutcomePrior(unit: SemanticUnit): number {
  const signals = unit.usage.outcomeSignals;
  if (signals.length === 0) return 0;
  const positive = signals.filter((s) => s.type === 'positive').length;
  const negative = signals.filter((s) => s.type === 'negative').length;
  const total = positive + negative;
  if (total === 0) return 0;
  return (positive - negative) / (total + 1);
}

// ---------------------------------------------------------------------------
// Weight presets for specific strategies
// ---------------------------------------------------------------------------

/**
 * Flat vector baseline — vector similarity only, no tag boosting.
 * Matches what "flat-vector" strategy in the benchmark tests.
 */
export const WEIGHTS_VECTOR_ONLY: WeightVector = {
  vectorSimilarity: 1.0,
};

/**
 * Tag-heavy weighting — puts more weight on tag signals.
 * Useful when tags are high-quality and vector similarity is noisy.
 */
export const WEIGHTS_TAG_HEAVY: WeightVector = {
  vectorSimilarity: 0.4,
  tagOverlapContext: 0.15,
  tagOverlapDomain: 0.2,
  tagOverlapAppliesTo: 0.25,
  tagOverlapMethodology: 0.2,
  tagOverlapOther: 0.1,
  contentTypePreferred: 0.05,
  usagePrior: 0.03,
  outcomePrior: 0.03,
};
