/**
 * Recursion Safety
 *
 * Tracks objective lineage to detect cycles and enforce maximum recursion depth.
 *
 * When a sub-objective is created during planning, it inherits an ObjectiveLineage
 * from its parent. The lineage tracks the chain of ancestors, and the depth.
 * Before adding a new sub-objective, the system checks:
 * 1. Does the new objective duplicate any ancestor? (cycle detection)
 * 2. Has the maximum depth been reached?
 *
 * Cycle detection uses two signals:
 * - Direct ID match (exact same objective)
 * - Description similarity above a threshold (likely cycle)
 */

import type { Objective } from './plan-dag.js';

// ---------------------------------------------------------------------------
// Lineage tracking
// ---------------------------------------------------------------------------

/**
 * The lineage of an objective — the chain of ancestor objectives that
 * led to its creation through sub-objective decomposition.
 */
export interface ObjectiveLineage {
  /** Ancestor objective IDs, root first. */
  ancestorIds: string[];
  /** Compact descriptions of ancestors for similarity checking. */
  ancestorDescriptions: { id: string; description: string }[];
  /** Current depth in the recursion (root objective = 0). */
  depth: number;
}

/**
 * Default maximum recursion depth.
 * For ambiguous objectives without known types that require iterative
 * meta-plan invocation, this caps the deepest sub-objective tree.
 */
export const DEFAULT_MAX_RECURSION_DEPTH = 8;

/**
 * Default similarity threshold for cycle detection.
 * If a new objective's description is more similar than this to an ancestor's,
 * it's flagged as a likely cycle. 0.85 = quite strict — usually catches
 * paraphrased duplicates but allows distinct sub-problems.
 */
export const DEFAULT_CYCLE_SIMILARITY_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Cycle detection result
// ---------------------------------------------------------------------------

export interface CycleCheckResult {
  /** True if the proposed objective is safe to add. */
  safe: boolean;
  /** Reason if unsafe. */
  reason?: 'depth-exceeded' | 'duplicate-id' | 'similar-to-ancestor';
  /** Detail message. */
  detail?: string;
  /** The conflicting ancestor (if 'similar-to-ancestor' or 'duplicate-id'). */
  conflictAncestorId?: string;
  /** Similarity score (if 'similar-to-ancestor'). */
  similarity?: number;
}

// ---------------------------------------------------------------------------
// Recursion safety guard
// ---------------------------------------------------------------------------

export interface RecursionGuardConfig {
  /** Maximum recursion depth. */
  maxDepth: number;
  /** Similarity threshold for cycle detection. */
  cycleSimilarityThreshold: number;
}

const DEFAULT_CONFIG: RecursionGuardConfig = {
  maxDepth: DEFAULT_MAX_RECURSION_DEPTH,
  cycleSimilarityThreshold: DEFAULT_CYCLE_SIMILARITY_THRESHOLD,
};

export class RecursionGuard {
  private config: RecursionGuardConfig;

  constructor(config?: Partial<RecursionGuardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a new lineage for a root objective.
   */
  rootLineage(): ObjectiveLineage {
    return { ancestorIds: [], ancestorDescriptions: [], depth: 0 };
  }

  /**
   * Create a child lineage from a parent.
   */
  childLineage(parent: ObjectiveLineage, parentObjective: Objective): ObjectiveLineage {
    return {
      ancestorIds: [...parent.ancestorIds, parentObjective.id],
      ancestorDescriptions: [
        ...parent.ancestorDescriptions,
        { id: parentObjective.id, description: parentObjective.description },
      ],
      depth: parent.depth + 1,
    };
  }

  /**
   * Check whether adding a new sub-objective is safe.
   * Returns CycleCheckResult.safe = true if the objective can be added.
   */
  check(proposed: Pick<Objective, 'id' | 'description'>, lineage: ObjectiveLineage): CycleCheckResult {
    // 1. Depth check
    if (lineage.depth >= this.config.maxDepth) {
      return {
        safe: false,
        reason: 'depth-exceeded',
        detail: `Recursion depth ${lineage.depth} reached maximum ${this.config.maxDepth}`,
      };
    }

    // 2. Direct ID match
    if (lineage.ancestorIds.includes(proposed.id)) {
      return {
        safe: false,
        reason: 'duplicate-id',
        detail: `Objective '${proposed.id}' is already an ancestor`,
        conflictAncestorId: proposed.id,
      };
    }

    // 3. Similarity check against ancestors
    for (const ancestor of lineage.ancestorDescriptions) {
      const sim = this.descriptionSimilarity(proposed.description, ancestor.description);
      if (sim >= this.config.cycleSimilarityThreshold) {
        return {
          safe: false,
          reason: 'similar-to-ancestor',
          detail: `Proposed objective is too similar to ancestor '${ancestor.id}' (similarity ${sim.toFixed(2)} >= ${this.config.cycleSimilarityThreshold})`,
          conflictAncestorId: ancestor.id,
          similarity: sim,
        };
      }
    }

    return { safe: true };
  }

  /**
   * Description similarity using normalized Jaccard on words.
   * Cheap and approximate — for cycle detection, false positives are
   * acceptable (refuses suspect cases) but false negatives miss cycles.
   *
   * For more sophisticated similarity, the system could use embeddings.
   * Jaccard catches obvious paraphrases and trivial restatements.
   */
  private descriptionSimilarity(a: string, b: string): number {
    const wordsA = this.normalizeWords(a);
    const wordsB = this.normalizeWords(b);

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) intersection++;
    }

    const union = wordsA.size + wordsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private normalizeWords(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
    );
  }
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'has',
  'are', 'was', 'were', 'will', 'should', 'must', 'can', 'may',
  'into', 'using', 'use', 'used', 'your', 'their', 'them', 'these', 'those',
  'how', 'what', 'when', 'where', 'why', 'who', 'which',
]);
