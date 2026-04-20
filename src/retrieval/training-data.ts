/**
 * Training Data Store for retrieval.
 *
 * Accumulates (query, candidate unit, features, relevance label) examples
 * from two sources:
 * - Benchmark runs with hand-crafted relevance judgments
 * - Agent feedback (usedUnits, unusedUnits, foundViaFollowUp)
 *
 * When enough examples accumulate, the store exports them for training a
 * reranker model. Until then, it's diagnostic data.
 *
 * Each example is:
 *   { query, queryTags, features, label }
 * where label ∈ {relevant, irrelevant} (binary) or a numeric relevance score.
 */

import type { RetrievalFeatures } from './feature-scorer.js';

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

export type RelevanceLabel = 'relevant' | 'irrelevant';

export interface TrainingExample {
  id: string;
  /** The query text. */
  query: string;
  /** Query tags at time of retrieval. */
  queryTags: string[];
  /** The context the query was made from. */
  contextId: string;
  /** Features extracted for the (query, unit) pair. */
  features: RetrievalFeatures;
  /** Ground-truth label (or best estimate). */
  label: RelevanceLabel;
  /** Numeric relevance score (0..1) if graded, else 0 or 1 from label. */
  relevanceScore: number;
  /** Source of this label — benchmark judgment, agent feedback, etc. */
  source: TrainingSource;
  /** ID of the run/session this came from (for grouping). */
  runId?: string;
  /** Unit ID (helps detect duplicates and trace back). */
  unitId: string;
  timestamp: number;
}

export type TrainingSource =
  | 'benchmark-judgment'     // hand-crafted relevance judgment
  | 'agent-used'             // agent reported the unit was used
  | 'agent-unused'           // agent reported the unit was provided but unused
  | 'agent-follow-up'        // agent retrieved this via follow-up query (implies not initially retrieved)
  | 'synthetic'              // generated from synthetic data
  ;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface TrainingDataStore {
  record(example: TrainingExample): Promise<void>;
  recordBatch(examples: TrainingExample[]): Promise<void>;
  /** Get all examples, optionally filtered by source. */
  getAll(options?: { source?: TrainingSource; limit?: number }): Promise<TrainingExample[]>;
  /** Count by source. */
  counts(): Promise<Record<TrainingSource, number>>;
  clear(): Promise<void>;
}

export class InMemoryTrainingDataStore implements TrainingDataStore {
  private examples: TrainingExample[] = [];

  async record(example: TrainingExample): Promise<void> {
    this.examples.push(example);
  }

  async recordBatch(examples: TrainingExample[]): Promise<void> {
    this.examples.push(...examples);
  }

  async getAll(options?: {
    source?: TrainingSource;
    limit?: number;
  }): Promise<TrainingExample[]> {
    let filtered = this.examples;
    if (options?.source) {
      filtered = filtered.filter((e) => e.source === options.source);
    }
    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }
    return [...filtered];
  }

  async counts(): Promise<Record<TrainingSource, number>> {
    const counts = {
      'benchmark-judgment': 0,
      'agent-used': 0,
      'agent-unused': 0,
      'agent-follow-up': 0,
      'synthetic': 0,
    } as Record<TrainingSource, number>;
    for (const e of this.examples) {
      counts[e.source]++;
    }
    return counts;
  }

  async clear(): Promise<void> {
    this.examples = [];
  }
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

/**
 * Convert a benchmark relevance level to label + numeric score.
 * Uses the same mapping as the benchmark metrics module.
 */
export function relevanceLevelToLabel(
  level: 'essential' | 'helpful' | 'tangential' | 'irrelevant',
): { label: RelevanceLabel; score: number } {
  switch (level) {
    case 'essential':  return { label: 'relevant', score: 1.0 };
    case 'helpful':    return { label: 'relevant', score: 0.67 };
    case 'tangential': return { label: 'relevant', score: 0.33 };
    case 'irrelevant': return { label: 'irrelevant', score: 0.0 };
  }
}
