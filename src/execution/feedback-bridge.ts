/**
 * Feedback Bridge
 *
 * Converts ExecutionFeedback (what the agent said about its context) into
 * TrainingExamples (labeled (query, unit, features) tuples for the training
 * dataset).
 *
 * Mappings:
 * - feedback.usedUnits[]         → label 'relevant', source 'agent-used'
 * - feedback.unusedUnits[]       → label 'irrelevant', source 'agent-unused'
 * - feedback.foundViaFollowUp[]  → label 'relevant', source 'agent-follow-up'
 *   (these are particularly strong signals that the initial retrieval missed them)
 *
 * The bridge:
 * 1. Re-embeds the query to get query vector
 * 2. For each referenced unit (by ID, with prefix matching), fetches it
 * 3. Computes the full feature vector for the (query, unit) pair
 * 4. Emits a TrainingExample with appropriate label, score, and source
 *
 * Every agent invocation that reports feedback can thus contribute training
 * data. Over time this accumulates into a meaningful dataset for training
 * the retrieval reranker.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  ExecutionFeedback,
  UnitUsageFeedback,
  UnusedUnitFeedback,
  FoundViaFollowUpFeedback,
} from './feedback.js';
import type {
  TrainingDataStore,
  TrainingExample,
  TrainingSource,
} from '../retrieval/training-data.js';
import type { SemanticUnit } from '../core/types.js';
import type { UnitStore } from '../storage/unit-store.js';
import type { Embedder } from '../storage/embedder.js';
import { extractFeatures } from '../retrieval/feature-scorer.js';

// ---------------------------------------------------------------------------
// Config & context
// ---------------------------------------------------------------------------

export interface FeedbackBridgeDeps {
  unitStore: UnitStore;
  embedder: Embedder;
  trainingDataStore: TrainingDataStore;
}

export interface FeedbackBridgeContext {
  /** The representative query text used for training (typically the action description or primary query). */
  query: string;
  /** The tags used for query-tag scoring during retrieval. */
  queryTags: string[];
  /** Bounded context the query was made from. */
  contextId: string;
  /** Optional run/session ID for grouping. */
  runId?: string;
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a unit reference from feedback (may be a full UUID or a prefix).
 * Returns the unique match or null.
 */
async function resolveUnit(
  reference: string,
  unitStore: UnitStore,
): Promise<SemanticUnit | null> {
  const trimmed = reference.trim();
  if (!trimmed) return null;

  // Strip common prefixes agents use (e.g., "id:abc12345")
  const bare = trimmed.startsWith('id:') ? trimmed.slice(3) : trimmed;

  // Try exact match first
  const exact = await unitStore.get(bare);
  if (exact) return exact;

  // Prefix match (require at least 8 chars to avoid weak matches)
  if (bare.length >= 8) {
    const all = await unitStore.getAll();
    const matches = all.filter((u) => u.id.startsWith(bare));
    if (matches.length === 1) return matches[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main bridge function
// ---------------------------------------------------------------------------

export interface BridgeResult {
  /** Number of training examples successfully recorded. */
  recorded: number;
  /** Number of feedback entries skipped (e.g., unit not found). */
  skipped: number;
  /** Per-source breakdown of recorded examples. */
  bySource: Record<TrainingSource, number>;
}

/**
 * Convert the execution feedback into training examples and record them.
 * Returns counts of recorded and skipped entries.
 */
export async function recordFeedbackAsTraining(
  feedback: ExecutionFeedback,
  context: FeedbackBridgeContext,
  deps: FeedbackBridgeDeps,
): Promise<BridgeResult> {
  const result: BridgeResult = {
    recorded: 0,
    skipped: 0,
    bySource: {
      'benchmark-judgment': 0,
      'agent-used': 0,
      'agent-unused': 0,
      'agent-follow-up': 0,
      'synthetic': 0,
    },
  };

  // Re-embed the query once
  const queryEmbedding = await deps.embedder.embed(context.query);

  // Track unit IDs we've already emitted to avoid duplicates within one feedback
  const emitted = new Set<string>();

  // ── usedUnits → 'agent-used', label 'relevant' ──
  for (const used of feedback.usedUnits) {
    const example = await buildExample({
      unitRef: used.unitId,
      source: 'agent-used',
      label: 'relevant',
      relevanceScore: used.importance,
      queryEmbedding,
      feedback,
      context,
      deps,
      emitted,
    });
    if (example) {
      await deps.trainingDataStore.record(example);
      result.recorded++;
      result.bySource['agent-used']++;
    } else {
      result.skipped++;
    }
  }

  // ── unusedUnits → 'agent-unused', label 'irrelevant' ──
  for (const unused of feedback.unusedUnits) {
    const example = await buildExample({
      unitRef: unused.unitId,
      source: 'agent-unused',
      label: 'irrelevant',
      relevanceScore: 0,
      queryEmbedding,
      feedback,
      context,
      deps,
      emitted,
    });
    if (example) {
      await deps.trainingDataStore.record(example);
      result.recorded++;
      result.bySource['agent-unused']++;
    } else {
      result.skipped++;
    }
  }

  // ── foundViaFollowUp → 'agent-follow-up', label 'relevant' (strong) ──
  // These are units the agent found via a subsequent query. They should have
  // been in the initial context — strong signal that retrieval missed them.
  for (const found of feedback.foundViaFollowUp) {
    const example = await buildExample({
      unitRef: found.unitId,
      source: 'agent-follow-up',
      label: 'relevant',
      relevanceScore: found.importance,
      queryEmbedding,
      feedback,
      context,
      deps,
      emitted,
    });
    if (example) {
      await deps.trainingDataStore.record(example);
      result.recorded++;
      result.bySource['agent-follow-up']++;
    } else {
      result.skipped++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Example construction
// ---------------------------------------------------------------------------

interface BuildExampleArgs {
  unitRef: string;
  source: TrainingSource;
  label: 'relevant' | 'irrelevant';
  relevanceScore: number;
  queryEmbedding: number[];
  feedback: ExecutionFeedback;
  context: FeedbackBridgeContext;
  deps: FeedbackBridgeDeps;
  emitted: Set<string>;
}

async function buildExample(args: BuildExampleArgs): Promise<TrainingExample | null> {
  const { unitRef, source, label, relevanceScore, queryEmbedding, context, deps, emitted } = args;

  const unit = await resolveUnit(unitRef, deps.unitStore);
  if (!unit) return null;
  if (emitted.has(unit.id)) return null; // Dedupe within this feedback
  emitted.add(unit.id);

  // Compute vector similarity from embeddings
  const vectorSimilarity = unit.embedding
    ? cosineSimilarity(queryEmbedding, unit.embedding)
    : 0;

  // Extract full feature vector
  const features = extractFeatures({
    vectorSimilarity,
    queryTags: context.queryTags,
    unit,
  });

  return {
    id: uuidv4(),
    query: context.query,
    queryTags: [...context.queryTags],
    contextId: context.contextId,
    features,
    label,
    relevanceScore,
    source,
    runId: context.runId,
    unitId: unit.id,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}
