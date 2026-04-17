/**
 * Acquisition step: orchestrates content → chunk → classify → embed → store.
 * Enforces write rules: the acquiring agent must have write access to the target context.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  SemanticUnit,
  AcquireOptions,
  PipelineContext,
  UsageStats,
  BoundedContext,
} from '../core/types.js';
import type { Chunker } from './chunker.js';
import type { Classifier } from './classifier.js';
import type { Embedder } from '../storage/embedder.js';
import type { VectorStore } from '../storage/vector-store.js';
import type { UnitStore } from '../storage/unit-store.js';
import type { ContextStore } from '../storage/context-store.js';

export interface AcquisitionDeps {
  chunker: Chunker;
  classifier: Classifier;
  embedder: Embedder;
  vectorStore: VectorStore;
  unitStore: UnitStore;
  contextStore?: ContextStore;
}

export class WriteAccessError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly contextId: string,
    public readonly reason: string,
  ) {
    super(`Write access denied: agent '${agentId}' cannot write to context '${contextId}' — ${reason}`);
    this.name = 'WriteAccessError';
  }
}

const DEFAULT_USAGE: UsageStats = {
  retrievalCount: 0,
  inclusionCount: 0,
  outcomeSignals: [],
};

/**
 * Check whether an agent has write access to a context.
 * Returns null if allowed, or an error message if denied.
 */
export function checkWriteAccess(
  context: BoundedContext,
  agentId: string | undefined,
  contentType: string | undefined,
): string | null {
  const { writeRules } = context;

  // Check writer allowlist (empty = unrestricted)
  if (writeRules.writers.length > 0 && agentId) {
    if (!writeRules.writers.includes(agentId)) {
      return `agent '${agentId}' is not in the writers list for context '${context.id}'`;
    }
  }

  // Check content type allowlist
  if (writeRules.allowedContentTypes && contentType) {
    if (!writeRules.allowedContentTypes.includes(contentType as any)) {
      return `content type '${contentType}' is not allowed in context '${context.id}'`;
    }
  }

  return null;
}

/**
 * Acquire content: chunk it, classify each chunk, embed, and store.
 * Enforces write rules if a contextStore is provided and the agent is identified.
 */
export async function acquireContent(
  content: string,
  contextId: string,
  deps: AcquisitionDeps,
  options?: AcquireOptions,
): Promise<SemanticUnit[]> {
  const now = Date.now();

  // Enforce write rules if we have a context store and agent identity
  if (deps.contextStore && options?.createdBy) {
    const ctx = await deps.contextStore.getContext(contextId);
    if (ctx) {
      const denial = checkWriteAccess(ctx, options.createdBy, options?.contentType);
      if (denial) {
        throw new WriteAccessError(options.createdBy, contextId, denial);
      }
    }
  }

  // 1. Chunk
  const chunks = deps.chunker.chunk(content, options?.chunkOptions);

  // 2. Classify each chunk
  const classifications = await Promise.all(
    chunks.map((c) => deps.classifier.classify(c.content)),
  );

  // 3. Create semantic units with governance fields
  const units: SemanticUnit[] = chunks.map((chunk, i) => ({
    id: uuidv4(),
    content: chunk.content,
    metadata: {
      source: options?.sourceType ?? 'user',
      sourceType: options?.sourceType ?? 'user',
      contentType: options?.contentType ?? classifications[i].contentType,
      createdAt: now,
      updatedAt: now,
      tags: [
        ...(options?.tags ?? []),
        ...classifications[i].tags,
      ],
      chunkParentId: chunks.length > 1 ? `chunk-group-${now}` : undefined,
      createdBy: options?.createdBy,
      mutability: options?.mutability ?? 'assertion',
    },
    contextId,
    usage: { ...DEFAULT_USAGE, outcomeSignals: [] },
  }));

  // 4. Embed all units (with timing)
  const embedStart = Date.now();
  const embeddings = await deps.embedder.embedBatch(units.map((u) => u.content));
  const embeddingLatencyMs = Date.now() - embedStart;
  for (let i = 0; i < units.length; i++) {
    units[i].embedding = embeddings[i];
  }

  // 5. Store in vector store and unit store
  await Promise.all([
    ...units.map((u) => deps.vectorStore.add(u.id, u.embedding!, { contextId: u.contextId })),
    ...units.map((u) => deps.unitStore.add(u)),
  ]);

  // Attach telemetry metadata to units for the collector
  (units as any).__telemetry = {
    classifications,
    embeddingLatencyMs,
  };

  return units;
}

/**
 * Pipeline step handler for acquisition.
 * Reads content from PipelineContext.input.content and stores acquired units.
 */
export function createAcquireStep(deps: AcquisitionDeps) {
  return async (ctx: PipelineContext): Promise<PipelineContext> => {
    if (!ctx.input.content) return ctx;

    const units = await acquireContent(
      ctx.input.content,
      ctx.input.contextId,
      deps,
    );

    ctx.acquiredUnits.push(...units);
    const telemetry = (units as any).__telemetry;
    ctx.stepResults['acquire'] = {
      unitsCreated: units.length,
      classifications: telemetry?.classifications ?? [],
      embeddingLatencyMs: telemetry?.embeddingLatencyMs ?? 0,
      nearDuplicatesDetected: 0,
    };
    return ctx;
  };
}
