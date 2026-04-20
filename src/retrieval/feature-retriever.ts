/**
 * FeatureRetriever: retrieval using feature-based scoring.
 *
 * Workflow:
 * 1. First-stage retrieval: vector search for candidate units (fast, approximate)
 * 2. Feature extraction: compute feature vector for each (query, candidate) pair
 * 3. Scoring: linear combination of features with weight vector
 * 4. Rank and return top-k
 *
 * The weight vector is injectable — starts heuristic, eventually gets replaced
 * by a trained model. The feature extraction and first-stage retrieval stay the
 * same; only the scoring function changes.
 */

import type {
  RetrievalOptions,
  RetrievalResult,
  ScoredUnit,
} from '../core/types.js';
import type { Embedder } from '../storage/embedder.js';
import type { VectorStore } from '../storage/vector-store.js';
import type { UnitStore } from '../storage/unit-store.js';
import type { ContextStore } from '../storage/context-store.js';
import type { ScopeResolver } from './scope-resolver.js';
import type { Retriever } from './retriever.js';
import {
  extractFeatures,
  scoreFromFeatures,
  type WeightVector,
  type RetrievalFeatures,
  DEFAULT_WEIGHTS,
} from './feature-scorer.js';

export interface FeatureRetrieverDeps {
  embedder: Embedder;
  vectorStore: VectorStore;
  unitStore: UnitStore;
  /** Optional — if provided, candidates are restricted to scoped contexts. */
  contextStore?: ContextStore;
  scopeResolver?: ScopeResolver;
}

export interface FeatureRetrieverConfig {
  /** Weight vector for scoring. Default: DEFAULT_WEIGHTS. */
  weights?: WeightVector;
  /**
   * Multiplier on maxResults for first-stage retrieval.
   * Over-fetches so rescoring has alternatives to promote.
   * Default: 4.
   */
  firstStageMultiplier?: number;
}

export class FeatureRetriever implements Retriever {
  private weights: WeightVector;
  private firstStageMultiplier: number;

  constructor(
    private deps: FeatureRetrieverDeps,
    config?: FeatureRetrieverConfig,
  ) {
    this.weights = config?.weights ?? DEFAULT_WEIGHTS;
    this.firstStageMultiplier = config?.firstStageMultiplier ?? 4;
  }

  /** Update the weight vector (e.g., after training). */
  setWeights(weights: WeightVector): void {
    this.weights = weights;
  }

  async retrieve(
    query: string,
    options: RetrievalOptions,
  ): Promise<RetrievalResult> {
    // 1. Resolve scope if available (tags handle the rest via queryTags)
    const scopedContexts = this.deps.scopeResolver && this.deps.contextStore
      ? await this.deps.scopeResolver.resolve(
          options.contextId,
          this.deps.contextStore,
        )
      : [];

    // 2. Embed query
    const embedStart = Date.now();
    const queryEmbedding = await this.deps.embedder.embed(query);
    const queryEmbeddingLatencyMs = Date.now() - embedStart;

    // 3. First-stage retrieval: over-fetch from vector store
    const firstStageK = options.maxResults * this.firstStageMultiplier;
    const scopedContextIds = scopedContexts.length > 0
      ? new Set(scopedContexts.map((sc) => sc.contextId))
      : null;

    const vectorResults = await this.deps.vectorStore.search(
      queryEmbedding,
      firstStageK,
      scopedContextIds
        ? (_id, metadata) => {
            const ctxId = metadata?.['contextId'] as string | undefined;
            return ctxId != null && scopedContextIds.has(ctxId);
          }
        : undefined,
    );

    // 4. Feature extraction and rescoring
    const scored: ScoredUnit[] = [];
    const queryTags = options.queryTags ?? [];
    const queryContentTypes = options.contentTypes;
    let candidatesAfterContentFilter = 0;

    for (const vr of vectorResults) {
      const unit = await this.deps.unitStore.get(vr.id);
      if (!unit) continue;

      // Hard filters
      if (options.contentTypes && !options.contentTypes.includes(unit.metadata.contentType)) {
        continue;
      }
      if (options.tags && !options.tags.some((t) => unit.metadata.tags.includes(t))) {
        continue;
      }
      candidatesAfterContentFilter++;

      const features = extractFeatures({
        vectorSimilarity: vr.score,
        queryTags,
        queryContentTypes,
        unit,
      });

      const score = scoreFromFeatures(features, this.weights);

      if (options.minSimilarity != null && score < options.minSimilarity) {
        continue;
      }

      scored.push({
        unit,
        score,
        scopeWeight: 1, // Not used by feature scorer — hierarchy is in tags
        vectorSimilarity: vr.score,
      });

      await this.deps.unitStore.recordUsage(unit.id, 'retrieval');
    }

    // 5. Sort by score and limit
    scored.sort((a, b) => b.score - a.score);
    const limited = scored.slice(0, options.maxResults);

    const result: RetrievalResult & { __telemetry?: Record<string, unknown> } = {
      units: limited,
      query,
      contextId: options.contextId,
      scopesSearched: scopedContexts,
    };
    result.__telemetry = {
      queryEmbeddingLatencyMs,
      candidatesScanned: vectorResults.length,
      candidatesAfterScopeFilter: vectorResults.length,
      candidatesAfterContentFilter,
      scorer: 'feature-based',
      weightsUsed: Object.keys(this.weights).filter(
        (k) => this.weights[k as keyof WeightVector] != null,
      ),
    };

    return result;
  }

  /**
   * Expose feature extraction for training data collection.
   * Given a query, return (candidate unit, features) pairs for the first N
   * candidates — used when building training examples.
   */
  async extractFeaturesForQuery(
    query: string,
    options: RetrievalOptions & { firstStageK?: number },
  ): Promise<Array<{ unit: import('../core/types.js').SemanticUnit; features: RetrievalFeatures }>> {
    const queryEmbedding = await this.deps.embedder.embed(query);
    const firstStageK = options.firstStageK ?? options.maxResults * this.firstStageMultiplier;

    // Optionally filter by context
    let filter: ((id: string, meta?: Record<string, unknown>) => boolean) | undefined;
    if (this.deps.scopeResolver && this.deps.contextStore) {
      const scoped = await this.deps.scopeResolver.resolve(
        options.contextId,
        this.deps.contextStore,
      );
      const allowed = new Set(scoped.map((sc) => sc.contextId));
      filter = (_id, meta) => {
        const c = meta?.['contextId'] as string | undefined;
        return c != null && allowed.has(c);
      };
    }

    const vectorResults = await this.deps.vectorStore.search(
      queryEmbedding,
      firstStageK,
      filter,
    );

    const out: Array<{ unit: import('../core/types.js').SemanticUnit; features: RetrievalFeatures }> = [];
    for (const vr of vectorResults) {
      const unit = await this.deps.unitStore.get(vr.id);
      if (!unit) continue;
      const features = extractFeatures({
        vectorSimilarity: vr.score,
        queryTags: options.queryTags ?? [],
        queryContentTypes: options.contentTypes,
        unit,
      });
      out.push({ unit, features });
    }

    return out;
  }
}
