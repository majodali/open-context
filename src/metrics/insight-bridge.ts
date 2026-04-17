/**
 * InsightBridge: converts metrics analysis into semantic units.
 * This is the bridge between structured metrics data and the knowledge base.
 *
 * The analyzer produces AnalysisReport objects (structured data).
 * The bridge converts key findings into 'insight' semantic units that get
 * acquired into a designated context, making them queryable by curation agents.
 */

import type {
  AcquireOptions,
  SemanticUnit,
  ContentType,
} from '../core/types.js';
import type {
  AnalysisReport,
  ContextAnalysis,
  AggregatedSuggestion,
  ImplicitSignal,
  Issue,
} from './types.js';
import type { AcquisitionDeps } from '../acquisition/acquire.js';
import { acquireContent } from '../acquisition/acquire.js';

export interface InsightBridgeConfig {
  /** The context ID where insights are stored. */
  insightContextId: string;
  /** Agent ID to use as creator of insight units. */
  agentId: string;
  /** Minimum issue frequency to generate an insight. */
  minIssueFrequency: number;
  /** Minimum suggestion frequency to generate an insight. */
  minSuggestionFrequency: number;
}

const DEFAULT_CONFIG: InsightBridgeConfig = {
  insightContextId: 'root',
  agentId: 'system:insight-bridge',
  minIssueFrequency: 1,
  minSuggestionFrequency: 1,
};

export class InsightBridge {
  private config: InsightBridgeConfig;

  constructor(config?: Partial<InsightBridgeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Convert an analysis report into semantic units and acquire them.
   * Returns the acquired units.
   */
  async processReport(
    report: AnalysisReport,
    deps: AcquisitionDeps,
  ): Promise<SemanticUnit[]> {
    const insights: string[] = [];

    // Overall health insight
    if (report.runCount > 0) {
      insights.push(
        `Overall system health: ${report.runCount} runs analyzed, ` +
        `success rate ${(report.overallSuccessRate * 100).toFixed(0)}%, ` +
        `average quality ${(report.averageQuality * 100).toFixed(0)}%. ` +
        `Period: ${new Date(report.period.from).toISOString()} to ${new Date(report.period.to).toISOString()}.`,
      );
    }

    // Context-specific insights
    for (const ctx of report.contextAnalyses) {
      if (ctx.runCount >= 3) {
        const issues: string[] = [];
        if (ctx.successRate < 0.7) issues.push(`low success rate (${(ctx.successRate * 100).toFixed(0)}%)`);
        if (ctx.averageRetrievalScore < 0.4) issues.push(`low retrieval scores (${ctx.averageRetrievalScore.toFixed(2)})`);
        if (ctx.tokenUtilization > 0.9) issues.push(`high token utilization (${(ctx.tokenUtilization * 100).toFixed(0)}%)`);

        if (issues.length > 0) {
          insights.push(
            `Context '${ctx.contextName}' (${ctx.contextId}) has concerns: ${issues.join(', ')}. ` +
            `Based on ${ctx.runCount} runs with average quality ${(ctx.averageQuality * 100).toFixed(0)}%.`,
          );
        }
      }
    }

    // Issue insights
    for (const issue of report.topIssues) {
      if (issue.frequency >= this.config.minIssueFrequency) {
        insights.push(
          `Detected issue (${issue.severity}): ${issue.description}. ` +
          `Occurred ${issue.frequency} times across contexts: ${issue.affectedContexts.join(', ')}.`,
        );
      }
    }

    // Suggestion insights
    for (const suggestion of report.topSuggestions) {
      if (suggestion.frequency >= this.config.minSuggestionFrequency) {
        insights.push(
          `Recurring improvement suggestion (${suggestion.category}): ${suggestion.description}. ` +
          `Suggested ${suggestion.frequency} times with average priority rank ${suggestion.averageRank.toFixed(1)}.`,
        );
      }
    }

    // Implicit signal insights
    const signalSummary = this.summarizeSignals(report.implicitSignals);
    if (signalSummary) {
      insights.push(signalSummary);
    }

    if (insights.length === 0) return [];

    // Acquire all insights as semantic units
    const content = insights.join('\n');
    const options: AcquireOptions = {
      sourceType: 'system',
      contentType: 'insight',
      tags: ['metrics-insight', `report:${report.generatedAt}`],
      createdBy: this.config.agentId,
      mutability: 'record',
    };

    return acquireContent(
      content,
      this.config.insightContextId,
      deps,
      options,
    );
  }

  private summarizeSignals(signals: ImplicitSignal[]): string | null {
    if (signals.length === 0) return null;

    const bySeverity = { high: 0, medium: 0, low: 0 };
    const byType = new Map<string, number>();

    for (const signal of signals) {
      bySeverity[signal.severity]++;
      byType.set(signal.type, (byType.get(signal.type) ?? 0) + 1);
    }

    const typeSummary = [...byType.entries()]
      .map(([type, count]) => `${type} (${count})`)
      .join(', ');

    return (
      `Implicit signals detected: ${signals.length} total — ` +
      `${bySeverity.high} high, ${bySeverity.medium} medium, ${bySeverity.low} low severity. ` +
      `Types: ${typeSummary}.`
    );
  }
}
