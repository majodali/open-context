/**
 * Usage tracker: analyzes usage patterns to support curation decisions.
 */

import type { SemanticUnit } from '../core/types.js';
import type { UnitStore } from '../storage/unit-store.js';

export interface UsageReport {
  totalUnits: number;
  neverRetrieved: SemanticUnit[];
  neverIncluded: SemanticUnit[];
  mostRetrieved: SemanticUnit[];
  mostIncluded: SemanticUnit[];
  stale: SemanticUnit[];
  positiveOutcomes: SemanticUnit[];
  negativeOutcomes: SemanticUnit[];
}

export interface UsageTrackerConfig {
  /** Units not retrieved in this many ms are considered stale. */
  staleThresholdMs: number;
  /** Number of top units to include in "most" lists. */
  topN: number;
}

const DEFAULT_CONFIG: UsageTrackerConfig = {
  staleThresholdMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  topN: 10,
};

export class UsageTracker {
  private config: UsageTrackerConfig;

  constructor(config?: Partial<UsageTrackerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async generateReport(unitStore: UnitStore): Promise<UsageReport> {
    const all = await unitStore.getAll();
    const now = Date.now();

    const neverRetrieved = all.filter((u) => u.usage.retrievalCount === 0);
    const neverIncluded = all.filter((u) => u.usage.inclusionCount === 0);

    const stale = all.filter((u) => {
      const lastUsed = Math.max(
        u.usage.lastRetrievedAt ?? 0,
        u.usage.lastIncludedAt ?? 0,
      );
      return lastUsed > 0 && now - lastUsed > this.config.staleThresholdMs;
    });

    const sortedByRetrieval = [...all].sort(
      (a, b) => b.usage.retrievalCount - a.usage.retrievalCount,
    );

    const sortedByInclusion = [...all].sort(
      (a, b) => b.usage.inclusionCount - a.usage.inclusionCount,
    );

    const positiveOutcomes = all.filter((u) =>
      u.usage.outcomeSignals.some((s) => s.type === 'positive'),
    );

    const negativeOutcomes = all.filter((u) =>
      u.usage.outcomeSignals.some((s) => s.type === 'negative'),
    );

    return {
      totalUnits: all.length,
      neverRetrieved,
      neverIncluded,
      mostRetrieved: sortedByRetrieval.slice(0, this.config.topN),
      mostIncluded: sortedByInclusion.slice(0, this.config.topN),
      stale,
      positiveOutcomes,
      negativeOutcomes,
    };
  }
}
