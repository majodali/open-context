import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMetricsStore } from '../src/metrics/metrics-store.js';
import { ImplicitSignalDetector } from '../src/metrics/implicit-signals.js';
import type { RunRecord, StepTelemetry, RetrieveTelemetry, AssembleTelemetry } from '../src/metrics/types.js';

function makeRetrieveTelemetry(overrides?: Partial<RetrieveTelemetry>): StepTelemetry {
  return {
    stepId: 'retrieve',
    stepType: 'retrieve',
    startedAt: Date.now(),
    completedAt: Date.now() + 10,
    durationMs: 10,
    status: 'success',
    details: {
      type: 'retrieve',
      queryEmbeddingLatencyMs: 5,
      candidatesScanned: 20,
      candidatesAfterScopeFilter: 15,
      candidatesAfterContentFilter: 10,
      resultsReturned: 5,
      scoreDistribution: { min: 0.3, max: 0.9, median: 0.6, mean: 0.6 },
      scopesSearched: [],
      emptyScopes: [],
      ...overrides,
    },
  };
}

function makeAssembleTelemetry(overrides?: Partial<AssembleTelemetry>): StepTelemetry {
  return {
    stepId: 'assemble',
    stepType: 'assemble',
    startedAt: Date.now(),
    completedAt: Date.now() + 5,
    durationMs: 5,
    status: 'success',
    details: {
      type: 'assemble',
      tokenBudget: 1000,
      tokensUsed: 500,
      tokenUtilization: 0.5,
      unitsIncluded: 5,
      unitsExcludedByBudget: 0,
      sectionsPopulated: 3,
      sectionsEmpty: 0,
      unitIds: [],
      ...overrides,
    },
  };
}

function makeRun(overrides?: Partial<RunRecord>): RunRecord {
  return {
    runId: `run-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    input: { contextId: 'ctx1', query: 'test query' },
    profile: 'full',
    steps: [makeRetrieveTelemetry()],
    totalDurationMs: 100,
    unitsAcquired: 0,
    unitsRetrieved: 5,
    unitsAssembled: 3,
    unitIdsRetrieved: [],
    unitIdsAssembled: [],
    contextId: 'ctx1',
    ...overrides,
  };
}

describe('ImplicitSignalDetector', () => {
  let store: InMemoryMetricsStore;

  beforeEach(() => {
    store = new InMemoryMetricsStore();
  });

  it('detects repeated queries', async () => {
    const now = Date.now();
    const detector = new ImplicitSignalDetector({
      repeatWindowMs: 60_000,
      repeatSimilarityThreshold: 0.5,
    });

    await store.recordRun(makeRun({
      runId: 'r1',
      timestamp: now - 10_000,
      input: { contextId: 'ctx1', query: 'how to handle authentication tokens' },
    }));
    await store.recordRun(makeRun({
      runId: 'r2',
      timestamp: now - 5_000,
      input: { contextId: 'ctx1', query: 'how to handle authentication tokens' },
    }));
    await store.recordRun(makeRun({
      runId: 'r3',
      timestamp: now,
      input: { contextId: 'ctx1', query: 'how to handle authentication tokens' },
    }));

    const signals = await detector.detect(store);
    const repeated = signals.filter((s) => s.type === 'repeated-query');
    expect(repeated.length).toBeGreaterThan(0);
    expect(repeated[0].severity).toBe('medium'); // 3 repeats
  });

  it('detects empty retrievals', async () => {
    const detector = new ImplicitSignalDetector({
      emptyRetrievalScoreThreshold: 0.3,
    });

    await store.recordRun(makeRun({
      runId: 'r1',
      steps: [makeRetrieveTelemetry({
        resultsReturned: 0,
        scoreDistribution: { min: 0, max: 0, median: 0, mean: 0 },
      })],
    }));

    const signals = await detector.detect(store);
    const empty = signals.filter((s) => s.type === 'empty-retrieval');
    expect(empty.length).toBeGreaterThan(0);
    expect(empty[0].severity).toBe('high');
  });

  it('detects iteration bursts', async () => {
    const now = Date.now();
    const detector = new ImplicitSignalDetector({
      burstWindowMs: 60_000,
      burstThreshold: 3,
    });

    for (let i = 0; i < 5; i++) {
      await store.recordRun(makeRun({
        runId: `burst-${i}`,
        timestamp: now - (i * 1000),
        contextId: 'ctx1',
      }));
    }

    const signals = await detector.detect(store);
    const bursts = signals.filter((s) => s.type === 'iteration-burst');
    expect(bursts.length).toBeGreaterThan(0);
  });

  it('detects budget exhaustion', async () => {
    const detector = new ImplicitSignalDetector({
      budgetExhaustedThreshold: 0.9,
    });

    await store.recordRun(makeRun({
      runId: 'r1',
      steps: [makeAssembleTelemetry({
        tokenBudget: 1000,
        tokensUsed: 980,
        tokenUtilization: 0.98,
        unitsExcludedByBudget: 3,
      })],
    }));

    const signals = await detector.detect(store);
    const exhausted = signals.filter((s) => s.type === 'budget-exhausted');
    expect(exhausted.length).toBeGreaterThan(0);
  });

  it('returns empty for clean run history', async () => {
    const detector = new ImplicitSignalDetector();
    await store.recordRun(makeRun({ runId: 'r1' }));

    const signals = await detector.detect(store);
    // Should not detect repeated-query (only 1 run), burst (only 1 run), etc.
    const repeats = signals.filter((s) => s.type === 'repeated-query');
    const bursts = signals.filter((s) => s.type === 'iteration-burst');
    expect(repeats).toHaveLength(0);
    expect(bursts).toHaveLength(0);
  });
});
