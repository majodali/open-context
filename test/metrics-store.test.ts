import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMetricsStore } from '../src/metrics/metrics-store.js';
import type { RunRecord, RunOutcome, ImplicitSignal } from '../src/metrics/types.js';

function makeRun(overrides?: Partial<RunRecord>): RunRecord {
  return {
    runId: 'run-1',
    timestamp: Date.now(),
    input: { contextId: 'ctx1', query: 'test query' },
    profile: 'full',
    steps: [],
    totalDurationMs: 100,
    unitsAcquired: 0,
    unitsRetrieved: 5,
    unitsAssembled: 3,
    unitIdsRetrieved: ['u1', 'u2', 'u3', 'u4', 'u5'],
    unitIdsAssembled: ['u1', 'u2', 'u3'],
    contextId: 'ctx1',
    ...overrides,
  };
}

function makeOutcome(overrides?: Partial<RunOutcome>): RunOutcome {
  return {
    runId: 'run-1',
    reportedAt: Date.now(),
    reportedBy: 'test-agent',
    success: true,
    quality: 0.8,
    improvements: [],
    unitFeedback: [],
    ...overrides,
  };
}

describe('InMemoryMetricsStore', () => {
  let store: InMemoryMetricsStore;

  beforeEach(() => {
    store = new InMemoryMetricsStore();
  });

  it('records and retrieves a run', async () => {
    await store.recordRun(makeRun());
    const run = await store.getRun('run-1');
    expect(run).not.toBeNull();
    expect(run!.runId).toBe('run-1');
  });

  it('returns null for missing run', async () => {
    expect(await store.getRun('nonexistent')).toBeNull();
  });

  it('gets runs by context', async () => {
    await store.recordRun(makeRun({ runId: 'r1', contextId: 'ctx1' }));
    await store.recordRun(makeRun({ runId: 'r2', contextId: 'ctx1' }));
    await store.recordRun(makeRun({ runId: 'r3', contextId: 'ctx2' }));

    const runs = await store.getRunsByContext('ctx1');
    expect(runs).toHaveLength(2);
  });

  it('gets recent runs with limit', async () => {
    const now = Date.now();
    await store.recordRun(makeRun({ runId: 'r1', timestamp: now - 100 }));
    await store.recordRun(makeRun({ runId: 'r2', timestamp: now - 50 }));
    await store.recordRun(makeRun({ runId: 'r3', timestamp: now }));

    const runs = await store.getRecentRuns(2);
    expect(runs).toHaveLength(2);
    expect(runs[0].runId).toBe('r3'); // Most recent first
  });

  it('gets runs in time range', async () => {
    const now = Date.now();
    await store.recordRun(makeRun({ runId: 'r1', timestamp: now - 1000 }));
    await store.recordRun(makeRun({ runId: 'r2', timestamp: now - 500 }));
    await store.recordRun(makeRun({ runId: 'r3', timestamp: now }));

    const runs = await store.getRunsInRange(now - 600, now - 400);
    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe('r2');
  });

  it('records outcome and attaches to run', async () => {
    await store.recordRun(makeRun({ runId: 'r1' }));
    await store.recordOutcome(makeOutcome({ runId: 'r1', quality: 0.9 }));

    const run = await store.getRun('r1');
    expect(run!.outcome).toBeDefined();
    expect(run!.outcome!.quality).toBe(0.9);

    const outcome = await store.getOutcome('r1');
    expect(outcome).not.toBeNull();
  });

  it('gets outcomes filtered by context', async () => {
    await store.recordRun(makeRun({ runId: 'r1', contextId: 'ctx1' }));
    await store.recordRun(makeRun({ runId: 'r2', contextId: 'ctx2' }));
    await store.recordOutcome(makeOutcome({ runId: 'r1' }));
    await store.recordOutcome(makeOutcome({ runId: 'r2' }));

    const outcomes = await store.getOutcomes('ctx1');
    expect(outcomes).toHaveLength(1);
  });

  it('records and retrieves implicit signals', async () => {
    const signal: ImplicitSignal = {
      type: 'repeated-query',
      detectedAt: Date.now(),
      runIds: ['r1', 'r2'],
      contextId: 'ctx1',
      severity: 'medium',
      detail: { count: 2 },
    };
    await store.recordImplicitSignal(signal);

    const signals = await store.getImplicitSignals('ctx1');
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('repeated-query');
  });

  it('export/import round-trips data', async () => {
    await store.recordRun(makeRun({ runId: 'r1' }));
    await store.recordOutcome(makeOutcome({ runId: 'r1' }));
    await store.recordImplicitSignal({
      type: 'empty-retrieval',
      detectedAt: Date.now(),
      runIds: ['r1'],
      contextId: 'ctx1',
      severity: 'high',
      detail: {},
    });

    const exported = await store.exportAll();
    expect(exported.runs).toHaveLength(1);
    expect(exported.outcomes).toHaveLength(1);
    expect(exported.implicitSignals).toHaveLength(1);

    const store2 = new InMemoryMetricsStore();
    await store2.importAll(exported);

    expect(await store2.getRun('r1')).not.toBeNull();
    expect(await store2.getOutcome('r1')).not.toBeNull();
    expect((await store2.getImplicitSignals()).length).toBe(1);
  });
});
