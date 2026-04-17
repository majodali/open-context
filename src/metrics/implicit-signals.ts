/**
 * ImplicitSignalDetector: analyzes run history to detect patterns
 * that indicate retrieval or context problems.
 * Called on-demand — no background polling.
 */

import type { MetricsStore } from './metrics-store.js';
import type {
  ImplicitSignal,
  RunRecord,
  RetrieveTelemetry,
  AssembleTelemetry,
} from './types.js';

export interface ImplicitSignalConfig {
  /** Runs with same query within this window → repeated-query signal. */
  repeatWindowMs: number;
  /** Minimum query text overlap to consider "same query" (0.0–1.0, Jaccard). */
  repeatSimilarityThreshold: number;
  /** Compare last N runs vs previous N for score degradation. */
  degradationWindowRuns: number;
  /** Minimum score drop to trigger degradation signal (0.0–1.0). */
  degradationThreshold: number;
  /** Many runs to same context within this window → iteration-burst. */
  burstWindowMs: number;
  /** Minimum runs in burst window to trigger. */
  burstThreshold: number;
  /** Retrieval scores below this → empty-retrieval signal. */
  emptyRetrievalScoreThreshold: number;
  /** Token utilization above this → budget-exhausted signal. */
  budgetExhaustedThreshold: number;
}

const DEFAULT_CONFIG: ImplicitSignalConfig = {
  repeatWindowMs: 5 * 60 * 1000,
  repeatSimilarityThreshold: 0.7,
  degradationWindowRuns: 20,
  degradationThreshold: 0.15,
  burstWindowMs: 10 * 60 * 1000,
  burstThreshold: 5,
  emptyRetrievalScoreThreshold: 0.3,
  budgetExhaustedThreshold: 0.95,
};

/**
 * Jaccard similarity on word sets — cheap text similarity for query comparison.
 */
function querySimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function getRetrieveTelemetry(run: RunRecord): RetrieveTelemetry | null {
  const step = run.steps.find((s) => s.stepType === 'retrieve');
  return step?.details.type === 'retrieve' ? step.details : null;
}

function getAssembleTelemetry(run: RunRecord): AssembleTelemetry | null {
  const step = run.steps.find((s) => s.stepType === 'assemble');
  return step?.details.type === 'assemble' ? step.details : null;
}

export class ImplicitSignalDetector {
  private config: ImplicitSignalConfig;

  constructor(config?: Partial<ImplicitSignalConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze recent runs and detect all implicit signals.
   */
  async detect(store: MetricsStore): Promise<ImplicitSignal[]> {
    const runs = await store.getAllRuns();
    if (runs.length === 0) return [];

    const signals: ImplicitSignal[] = [];

    signals.push(...this.detectRepeatedQueries(runs));
    signals.push(...this.detectScoreDegradation(runs));
    signals.push(...this.detectIterationBursts(runs));
    signals.push(...this.detectEmptyRetrievals(runs));
    signals.push(...this.detectBudgetExhausted(runs));

    // Record all detected signals
    for (const signal of signals) {
      await store.recordImplicitSignal(signal);
    }

    return signals;
  }

  private detectRepeatedQueries(runs: RunRecord[]): ImplicitSignal[] {
    const signals: ImplicitSignal[] = [];
    const now = Date.now();
    const recentRuns = runs.filter(
      (r) => r.input.query && now - r.timestamp < this.config.repeatWindowMs,
    );

    // Group by similar query
    const groups: RunRecord[][] = [];
    const assigned = new Set<string>();

    for (const run of recentRuns) {
      if (assigned.has(run.runId)) continue;

      const group = [run];
      assigned.add(run.runId);

      for (const other of recentRuns) {
        if (assigned.has(other.runId)) continue;
        if (
          run.input.query &&
          other.input.query &&
          querySimilarity(run.input.query, other.input.query) >= this.config.repeatSimilarityThreshold
        ) {
          group.push(other);
          assigned.add(other.runId);
        }
      }

      if (group.length >= 2) {
        signals.push({
          type: 'repeated-query',
          detectedAt: now,
          runIds: group.map((r) => r.runId),
          contextId: run.contextId,
          severity: group.length >= 4 ? 'high' : group.length >= 3 ? 'medium' : 'low',
          detail: {
            query: run.input.query,
            count: group.length,
            windowMs: this.config.repeatWindowMs,
          },
        });
      }
    }

    return signals;
  }

  private detectScoreDegradation(runs: RunRecord[]): ImplicitSignal[] {
    const signals: ImplicitSignal[] = [];
    const now = Date.now();
    const windowSize = this.config.degradationWindowRuns;

    // Group runs by context
    const byContext = new Map<string, RunRecord[]>();
    for (const run of runs) {
      const list = byContext.get(run.contextId) ?? [];
      list.push(run);
      byContext.set(run.contextId, list);
    }

    for (const [contextId, contextRuns] of byContext) {
      if (contextRuns.length < windowSize * 2) continue;

      // Sort by time
      contextRuns.sort((a, b) => a.timestamp - b.timestamp);

      const recent = contextRuns.slice(-windowSize);
      const previous = contextRuns.slice(-windowSize * 2, -windowSize);

      const recentScores = recent
        .map((r) => getRetrieveTelemetry(r)?.scoreDistribution.mean)
        .filter((s): s is number => s != null);
      const previousScores = previous
        .map((r) => getRetrieveTelemetry(r)?.scoreDistribution.mean)
        .filter((s): s is number => s != null);

      if (recentScores.length === 0 || previousScores.length === 0) continue;

      const recentMean = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
      const previousMean = previousScores.reduce((a, b) => a + b, 0) / previousScores.length;

      if (previousMean > 0) {
        const drop = (previousMean - recentMean) / previousMean;
        if (drop >= this.config.degradationThreshold) {
          signals.push({
            type: 'score-degradation',
            detectedAt: now,
            runIds: recent.map((r) => r.runId),
            contextId,
            severity: drop >= 0.3 ? 'high' : drop >= 0.2 ? 'medium' : 'low',
            detail: {
              previousMeanScore: previousMean,
              recentMeanScore: recentMean,
              dropPercent: drop * 100,
              windowSize,
            },
          });
        }
      }
    }

    return signals;
  }

  private detectIterationBursts(runs: RunRecord[]): ImplicitSignal[] {
    const signals: ImplicitSignal[] = [];
    const now = Date.now();

    // Group recent runs by context within burst window
    const byContext = new Map<string, RunRecord[]>();
    for (const run of runs) {
      if (now - run.timestamp > this.config.burstWindowMs) continue;
      const list = byContext.get(run.contextId) ?? [];
      list.push(run);
      byContext.set(run.contextId, list);
    }

    for (const [contextId, contextRuns] of byContext) {
      if (contextRuns.length >= this.config.burstThreshold) {
        signals.push({
          type: 'iteration-burst',
          detectedAt: now,
          runIds: contextRuns.map((r) => r.runId),
          contextId,
          severity: contextRuns.length >= this.config.burstThreshold * 2 ? 'high' : 'medium',
          detail: {
            count: contextRuns.length,
            windowMs: this.config.burstWindowMs,
          },
        });
      }
    }

    return signals;
  }

  private detectEmptyRetrievals(runs: RunRecord[]): ImplicitSignal[] {
    const signals: ImplicitSignal[] = [];
    const now = Date.now();

    for (const run of runs) {
      const rt = getRetrieveTelemetry(run);
      if (!rt) continue;

      if (
        rt.resultsReturned === 0 ||
        (rt.scoreDistribution.max > 0 &&
          rt.scoreDistribution.max < this.config.emptyRetrievalScoreThreshold)
      ) {
        signals.push({
          type: 'empty-retrieval',
          detectedAt: now,
          runIds: [run.runId],
          contextId: run.contextId,
          severity: rt.resultsReturned === 0 ? 'high' : 'medium',
          detail: {
            resultsReturned: rt.resultsReturned,
            maxScore: rt.scoreDistribution.max,
            query: run.input.query,
          },
        });
      }
    }

    return signals;
  }

  private detectBudgetExhausted(runs: RunRecord[]): ImplicitSignal[] {
    const signals: ImplicitSignal[] = [];
    const now = Date.now();

    for (const run of runs) {
      const at = getAssembleTelemetry(run);
      if (!at) continue;

      if (
        at.tokenUtilization >= this.config.budgetExhaustedThreshold &&
        at.unitsExcludedByBudget > 0
      ) {
        signals.push({
          type: 'budget-exhausted',
          detectedAt: now,
          runIds: [run.runId],
          contextId: run.contextId,
          severity: at.unitsExcludedByBudget > 5 ? 'high' : 'medium',
          detail: {
            tokenUtilization: at.tokenUtilization,
            unitsExcluded: at.unitsExcludedByBudget,
            tokensUsed: at.tokensUsed,
            tokenBudget: at.tokenBudget,
          },
        });
      }
    }

    return signals;
  }
}
