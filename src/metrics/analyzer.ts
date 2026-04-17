/**
 * MetricsAnalyzer: on-demand analysis of accumulated metrics.
 * Produces structured reports for curation agents and human oversight.
 */

import type { StepType } from '../core/types.js';
import type { ContextStore } from '../storage/context-store.js';
import type { UnitStore } from '../storage/unit-store.js';
import type { MetricsStore } from './metrics-store.js';
import type { ImplicitSignalDetector } from './implicit-signals.js';
import type {
  AnalysisOptions,
  AnalysisReport,
  ContextAnalysis,
  StepAnalysis,
  Issue,
  AggregatedSuggestion,
  RunRecord,
  RunComparison,
  RetrieveTelemetry,
  AssembleTelemetry,
  ImprovementCategory,
} from './types.js';

export class MetricsAnalyzer {
  constructor(
    private metricsStore: MetricsStore,
    private unitStore: UnitStore,
    private contextStore: ContextStore,
    private signalDetector: ImplicitSignalDetector,
  ) {}

  /**
   * Full analysis report across all or filtered runs.
   */
  async analyze(options?: AnalysisOptions): Promise<AnalysisReport> {
    const now = Date.now();
    let runs: RunRecord[];

    if (options?.fromTimestamp != null && options?.toTimestamp != null) {
      runs = await this.metricsStore.getRunsInRange(options.fromTimestamp, options.toTimestamp);
    } else if (options?.maxRuns) {
      runs = await this.metricsStore.getRecentRuns(options.maxRuns);
    } else {
      runs = await this.metricsStore.getAllRuns();
    }

    if (options?.contextId) {
      runs = runs.filter((r) => r.contextId === options.contextId);
    }

    // Detect implicit signals
    const implicitSignals = await this.signalDetector.detect(this.metricsStore);

    // Overall metrics
    const withOutcomes = runs.filter((r) => r.outcome != null);
    const overallSuccessRate = withOutcomes.length > 0
      ? withOutcomes.filter((r) => r.outcome!.success).length / withOutcomes.length
      : 0;
    const averageQuality = withOutcomes.length > 0
      ? withOutcomes.reduce((sum, r) => sum + r.outcome!.quality, 0) / withOutcomes.length
      : 0;

    // Per-context analysis
    const contextAnalyses = await this.analyzeContexts(runs);

    // Per-step analysis
    const stepAnalyses = this.analyzeSteps(runs);

    // Top issues
    const topIssues = this.identifyIssues(runs, implicitSignals);

    // Aggregate improvement suggestions
    const topSuggestions = this.aggregateSuggestions(runs);

    // Period
    const timestamps = runs.map((r) => r.timestamp);
    const from = timestamps.length > 0 ? Math.min(...timestamps) : now;
    const to = timestamps.length > 0 ? Math.max(...timestamps) : now;

    return {
      generatedAt: now,
      runCount: runs.length,
      period: { from, to },
      overallSuccessRate,
      averageQuality,
      contextAnalyses,
      stepAnalyses,
      topIssues,
      topSuggestions,
      implicitSignals,
    };
  }

  /**
   * Compare two runs side-by-side.
   */
  async compareRuns(runIdA: string, runIdB: string): Promise<RunComparison> {
    const runA = await this.metricsStore.getRun(runIdA);
    const runB = await this.metricsStore.getRun(runIdB);
    if (!runA || !runB) throw new Error('Run not found');

    const idsA = new Set(runA.unitIdsRetrieved);
    const idsB = new Set(runB.unitIdsRetrieved);

    const overlap = [...idsA].filter((id) => idsB.has(id));
    const onlyInA = [...idsA].filter((id) => !idsB.has(id));
    const onlyInB = [...idsB].filter((id) => !idsA.has(id));

    const scoreA = this.getMeanRetrievalScore(runA);
    const scoreB = this.getMeanRetrievalScore(runB);

    return {
      runA,
      runB,
      scoreChange: scoreB - scoreA,
      durationChange: runB.totalDurationMs - runA.totalDurationMs,
      unitsOverlap: overlap.length,
      unitsOnlyInA: onlyInA,
      unitsOnlyInB: onlyInB,
      qualityChange: runA.outcome && runB.outcome
        ? runB.outcome.quality - runA.outcome.quality
        : undefined,
    };
  }

  // -- Private helpers --

  private async analyzeContexts(runs: RunRecord[]): Promise<ContextAnalysis[]> {
    const byContext = new Map<string, RunRecord[]>();
    for (const run of runs) {
      const list = byContext.get(run.contextId) ?? [];
      list.push(run);
      byContext.set(run.contextId, list);
    }

    const analyses: ContextAnalysis[] = [];
    for (const [contextId, contextRuns] of byContext) {
      const ctx = await this.contextStore.getContext(contextId);
      const withOutcomes = contextRuns.filter((r) => r.outcome);
      const successRate = withOutcomes.length > 0
        ? withOutcomes.filter((r) => r.outcome!.success).length / withOutcomes.length
        : 0;
      const avgQuality = withOutcomes.length > 0
        ? withOutcomes.reduce((s, r) => s + r.outcome!.quality, 0) / withOutcomes.length
        : 0;

      const retrievalScores = contextRuns
        .map((r) => this.getMeanRetrievalScore(r))
        .filter((s) => s > 0);
      const avgRetrievalScore = retrievalScores.length > 0
        ? retrievalScores.reduce((a, b) => a + b, 0) / retrievalScores.length
        : 0;

      const utilizations = contextRuns
        .map((r) => this.getTokenUtilization(r))
        .filter((u) => u > 0);
      const avgUtilization = utilizations.length > 0
        ? utilizations.reduce((a, b) => a + b, 0) / utilizations.length
        : 0;

      analyses.push({
        contextId,
        contextName: ctx?.name ?? contextId,
        runCount: contextRuns.length,
        successRate,
        averageQuality: avgQuality,
        averageRetrievalScore: avgRetrievalScore,
        tokenUtilization: avgUtilization,
        commonIssues: [],
      });
    }

    return analyses;
  }

  private analyzeSteps(runs: RunRecord[]): StepAnalysis[] {
    const byStepType = new Map<StepType, { durations: number[]; errors: number; total: number }>();

    for (const run of runs) {
      for (const step of run.steps) {
        const entry = byStepType.get(step.stepType) ?? { durations: [], errors: 0, total: 0 };
        entry.durations.push(step.durationMs);
        entry.total++;
        if (step.status === 'error') entry.errors++;
        byStepType.set(step.stepType, entry);
      }
    }

    return [...byStepType.entries()].map(([stepType, data]) => ({
      stepType,
      averageDurationMs: data.durations.reduce((a, b) => a + b, 0) / data.durations.length,
      errorRate: data.total > 0 ? data.errors / data.total : 0,
      details: {
        totalExecutions: data.total,
        totalErrors: data.errors,
        minDurationMs: Math.min(...data.durations),
        maxDurationMs: Math.max(...data.durations),
      },
    }));
  }

  private identifyIssues(
    runs: RunRecord[],
    signals: { type: string; severity: string; contextId: string }[],
  ): Issue[] {
    const issues: Issue[] = [];

    // From implicit signals
    const signalCounts = new Map<string, { count: number; contexts: Set<string>; severity: string }>();
    for (const signal of signals) {
      const entry = signalCounts.get(signal.type) ?? {
        count: 0,
        contexts: new Set<string>(),
        severity: signal.severity,
      };
      entry.count++;
      entry.contexts.add(signal.contextId);
      if (signal.severity === 'high') entry.severity = 'high';
      signalCounts.set(signal.type, entry);
    }

    for (const [type, data] of signalCounts) {
      issues.push({
        category: type,
        description: this.describeSignalType(type),
        frequency: data.count,
        severity: data.severity as 'low' | 'medium' | 'high',
        affectedContexts: [...data.contexts],
      });
    }

    // From outcomes — recurring improvement categories
    const improvementCounts = new Map<string, { count: number; contexts: Set<string> }>();
    for (const run of runs) {
      if (!run.outcome) continue;
      for (const imp of run.outcome.improvements) {
        const entry = improvementCounts.get(imp.category) ?? {
          count: 0,
          contexts: new Set<string>(),
        };
        entry.count++;
        entry.contexts.add(run.contextId);
        improvementCounts.set(imp.category, entry);
      }
    }

    for (const [category, data] of improvementCounts) {
      if (data.count >= 2) {
        issues.push({
          category,
          description: `Recurring improvement suggestion: ${category}`,
          frequency: data.count,
          severity: data.count >= 5 ? 'high' : data.count >= 3 ? 'medium' : 'low',
          affectedContexts: [...data.contexts],
        });
      }
    }

    // Sort by frequency × severity weight
    const severityWeight = { high: 3, medium: 2, low: 1 };
    issues.sort(
      (a, b) =>
        b.frequency * severityWeight[b.severity] - a.frequency * severityWeight[a.severity],
    );

    return issues;
  }

  private aggregateSuggestions(runs: RunRecord[]): AggregatedSuggestion[] {
    const suggestions = new Map<
      string,
      { category: ImprovementCategory; descriptions: string[]; ranks: number[] }
    >();

    for (const run of runs) {
      if (!run.outcome) continue;
      for (const imp of run.outcome.improvements) {
        const key = `${imp.category}:${imp.description}`;
        const entry = suggestions.get(key) ?? {
          category: imp.category,
          descriptions: [],
          ranks: [],
        };
        entry.descriptions.push(imp.description);
        entry.ranks.push(imp.rank);
        suggestions.set(key, entry);
      }
    }

    return [...suggestions.values()]
      .map((entry) => ({
        category: entry.category,
        description: entry.descriptions[0],
        frequency: entry.ranks.length,
        averageRank: entry.ranks.reduce((a, b) => a + b, 0) / entry.ranks.length,
      }))
      .sort((a, b) => {
        // Sort by frequency desc, then by average rank asc (lower rank = more impactful)
        if (b.frequency !== a.frequency) return b.frequency - a.frequency;
        return a.averageRank - b.averageRank;
      });
  }

  private getMeanRetrievalScore(run: RunRecord): number {
    const step = run.steps.find((s) => s.stepType === 'retrieve');
    if (step?.details.type === 'retrieve') {
      return step.details.scoreDistribution.mean;
    }
    return 0;
  }

  private getTokenUtilization(run: RunRecord): number {
    const step = run.steps.find((s) => s.stepType === 'assemble');
    if (step?.details.type === 'assemble') {
      return step.details.tokenUtilization;
    }
    return 0;
  }

  private describeSignalType(type: string): string {
    switch (type) {
      case 'repeated-query':
        return 'Same or similar query repeated multiple times — retrieval may be returning insufficient results';
      case 'score-degradation':
        return 'Average retrieval scores declining over recent runs — knowledge store may need curation';
      case 'iteration-burst':
        return 'Many runs targeting same context in short window — possible retrieval or processing issues';
      case 'empty-retrieval':
        return 'Retrieval returned no results or very low scores — missing knowledge or poor embeddings';
      case 'budget-exhausted':
        return 'Token budget consistently exhausted with units excluded — retrieval may not be selective enough';
      default:
        return type;
    }
  }
}
