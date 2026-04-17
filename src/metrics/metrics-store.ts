/**
 * MetricsStore interface and in-memory implementation.
 * Stores run records, outcomes, and implicit signals.
 */

import type { RunRecord, RunOutcome, ImplicitSignal } from './types.js';

export interface MetricsStore {
  recordRun(record: RunRecord): Promise<void>;
  getRun(runId: string): Promise<RunRecord | null>;
  getRunsByContext(contextId: string, limit?: number): Promise<RunRecord[]>;
  getRunsInRange(from: number, to: number): Promise<RunRecord[]>;
  getRecentRuns(limit: number): Promise<RunRecord[]>;
  getAllRuns(): Promise<RunRecord[]>;

  recordOutcome(outcome: RunOutcome): Promise<void>;
  getOutcome(runId: string): Promise<RunOutcome | null>;
  getOutcomes(contextId?: string, limit?: number): Promise<RunOutcome[]>;

  recordImplicitSignal(signal: ImplicitSignal): Promise<void>;
  getImplicitSignals(contextId?: string, limit?: number): Promise<ImplicitSignal[]>;

  clear(): Promise<void>;

  // For persistence
  exportAll(): Promise<MetricsData>;
  importAll(data: MetricsData): Promise<void>;
}

export interface MetricsData {
  runs: RunRecord[];
  outcomes: RunOutcome[];
  implicitSignals: ImplicitSignal[];
}

export class InMemoryMetricsStore implements MetricsStore {
  private runs: RunRecord[] = [];
  private runIndex = new Map<string, RunRecord>();
  private outcomes: RunOutcome[] = [];
  private outcomeIndex = new Map<string, RunOutcome>();
  private signals: ImplicitSignal[] = [];

  async recordRun(record: RunRecord): Promise<void> {
    this.runs.push(record);
    this.runIndex.set(record.runId, record);
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    return this.runIndex.get(runId) ?? null;
  }

  async getRunsByContext(contextId: string, limit?: number): Promise<RunRecord[]> {
    const filtered = this.runs
      .filter((r) => r.contextId === contextId)
      .sort((a, b) => b.timestamp - a.timestamp);
    return limit ? filtered.slice(0, limit) : filtered;
  }

  async getRunsInRange(from: number, to: number): Promise<RunRecord[]> {
    return this.runs
      .filter((r) => r.timestamp >= from && r.timestamp <= to)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  async getRecentRuns(limit: number): Promise<RunRecord[]> {
    return [...this.runs]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async getAllRuns(): Promise<RunRecord[]> {
    return [...this.runs];
  }

  async recordOutcome(outcome: RunOutcome): Promise<void> {
    this.outcomes.push(outcome);
    this.outcomeIndex.set(outcome.runId, outcome);

    // Attach to run record
    const run = this.runIndex.get(outcome.runId);
    if (run) {
      run.outcome = outcome;
    }
  }

  async getOutcome(runId: string): Promise<RunOutcome | null> {
    return this.outcomeIndex.get(runId) ?? null;
  }

  async getOutcomes(contextId?: string, limit?: number): Promise<RunOutcome[]> {
    let filtered = [...this.outcomes];
    if (contextId) {
      const contextRunIds = new Set(
        this.runs.filter((r) => r.contextId === contextId).map((r) => r.runId),
      );
      filtered = filtered.filter((o) => contextRunIds.has(o.runId));
    }
    filtered.sort((a, b) => b.reportedAt - a.reportedAt);
    return limit ? filtered.slice(0, limit) : filtered;
  }

  async recordImplicitSignal(signal: ImplicitSignal): Promise<void> {
    this.signals.push(signal);
  }

  async getImplicitSignals(contextId?: string, limit?: number): Promise<ImplicitSignal[]> {
    let filtered = [...this.signals];
    if (contextId) {
      filtered = filtered.filter((s) => s.contextId === contextId);
    }
    filtered.sort((a, b) => b.detectedAt - a.detectedAt);
    return limit ? filtered.slice(0, limit) : filtered;
  }

  async clear(): Promise<void> {
    this.runs = [];
    this.runIndex.clear();
    this.outcomes = [];
    this.outcomeIndex.clear();
    this.signals = [];
  }

  async exportAll(): Promise<MetricsData> {
    return {
      runs: [...this.runs],
      outcomes: [...this.outcomes],
      implicitSignals: [...this.signals],
    };
  }

  async importAll(data: MetricsData): Promise<void> {
    await this.clear();
    for (const run of data.runs) {
      await this.recordRun(run);
    }
    for (const outcome of data.outcomes) {
      await this.recordOutcome(outcome);
    }
    for (const signal of data.implicitSignals) {
      await this.recordImplicitSignal(signal);
    }
  }
}
