/**
 * Retriever: scoped vector search with weighted scoring.
 */

import type {
  RetrievalOptions,
  RetrievalResult,
  ScoredUnit,
  PipelineContext,
} from '../core/types.js';
import type { Embedder } from '../storage/embedder.js';
import type { VectorStore } from '../storage/vector-store.js';
import type { UnitStore } from '../storage/unit-store.js';
import type { ContextStore } from '../storage/context-store.js';
import type { ScopeResolver } from './scope-resolver.js';

export interface Retriever {
  retrieve(query: string, options: RetrievalOptions): Promise<RetrievalResult>;
}

export interface RetrieverDeps {
  embedder: Embedder;
  vectorStore: VectorStore;
  unitStore: UnitStore;
  contextStore: ContextStore;
  scopeResolver: ScopeResolver;
}

export class VectorRetriever implements Retriever {
  constructor(private deps: RetrieverDeps) {}

  async retrieve(query: string, options: RetrievalOptions): Promise<RetrievalResult> {
    // 1. Resolve scope
    const scopedContexts = await this.deps.scopeResolver.resolve(
      options.contextId,
      this.deps.contextStore,
    );

    // Build a map of contextId → weight for quick lookup
    const weightMap = new Map<string, number>();
    for (const sc of scopedContexts) {
      weightMap.set(sc.contextId, sc.weight);
    }

    // 2. Embed query (with timing)
    const embedStart = Date.now();
    const queryEmbedding = await this.deps.embedder.embed(query);
    const queryEmbeddingLatencyMs = Date.now() - embedStart;

    // 3. Search vector store, filtering to scoped contexts
    const scopedContextIds = new Set(scopedContexts.map((sc) => sc.contextId));
    const searchK = options.maxResults * 3; // Over-fetch to account for filtering

    const vectorResults = await this.deps.vectorStore.search(
      queryEmbedding,
      searchK,
      (id, metadata) => {
        const ctxId = metadata?.['contextId'] as string | undefined;
        return ctxId != null && scopedContextIds.has(ctxId);
      },
    );

    // 4. Fetch full units and compute weighted scores
    const scoredUnits: ScoredUnit[] = [];
    let candidatesAfterContentFilter = 0;
    const scopeUnitCounts = new Map<string, number>();

    for (const vr of vectorResults) {
      const unit = await this.deps.unitStore.get(vr.id);
      if (!unit) continue;

      // Apply content type and tag filters
      if (options.contentTypes && !options.contentTypes.includes(unit.metadata.contentType)) {
        continue;
      }
      if (options.tags && !options.tags.some((t) => unit.metadata.tags.includes(t))) {
        continue;
      }
      candidatesAfterContentFilter++;

      const scopeWeight = weightMap.get(unit.contextId) ?? 0;
      const vectorSimilarity = vr.score;
      const score = vectorSimilarity * scopeWeight;

      if (options.minSimilarity != null && score < options.minSimilarity) {
        continue;
      }

      scoredUnits.push({ unit, score, scopeWeight, vectorSimilarity });

      // Track per-scope unit counts
      scopeUnitCounts.set(unit.contextId, (scopeUnitCounts.get(unit.contextId) ?? 0) + 1);

      // Record retrieval usage
      await this.deps.unitStore.recordUsage(unit.id, 'retrieval');
    }

    // 5. Sort by weighted score and limit
    scoredUnits.sort((a, b) => b.score - a.score);
    const limited = scoredUnits.slice(0, options.maxResults);

    // Build scope metrics
    const scopeMetrics = scopedContexts.map((sc) => ({
      contextId: sc.contextId,
      weight: sc.weight,
      unitsFound: scopeUnitCounts.get(sc.contextId) ?? 0,
    }));
    const emptyScopes = scopeMetrics
      .filter((sm) => sm.unitsFound === 0)
      .map((sm) => sm.contextId);

    // Attach telemetry to result
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
      scopeMetrics,
      emptyScopes,
    };

    return result;
  }
}

/**
 * Pipeline step handler for retrieval.
 */
export function createRetrieveStep(retriever: Retriever) {
  return async (ctx: PipelineContext): Promise<PipelineContext> => {
    if (!ctx.input.query) return ctx;

    const result = await retriever.retrieve(ctx.input.query, {
      contextId: ctx.input.contextId,
      maxResults: (ctx.input.params?.['maxResults'] as number) ?? 20,
      minSimilarity: ctx.input.params?.['minSimilarity'] as number | undefined,
      contentTypes: ctx.input.params?.['contentTypes'] as any,
      tags: ctx.input.params?.['tags'] as string[] | undefined,
      includeUsageStats: true,
    });

    ctx.retrievedUnits = result.units;
    const telemetry = (result as any).__telemetry ?? {};
    ctx.stepResults['retrieve'] = {
      unitsFound: result.units.length,
      scopesSearched: result.scopesSearched.length,
      queryEmbeddingLatencyMs: telemetry.queryEmbeddingLatencyMs ?? 0,
      candidatesScanned: telemetry.candidatesScanned ?? 0,
      candidatesAfterScopeFilter: telemetry.candidatesAfterScopeFilter ?? 0,
      candidatesAfterContentFilter: telemetry.candidatesAfterContentFilter ?? 0,
      scopeMetrics: telemetry.scopeMetrics ?? [],
      emptyScopes: telemetry.emptyScopes ?? [],
    };
    return ctx;
  };
}
