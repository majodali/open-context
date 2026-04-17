import { describe, it, expect } from 'vitest';
import { OpenContext, DeterministicEmbedder } from '../src/index.js';
import type { RunOutcome } from '../src/metrics/types.js';

describe('Metrics integration', () => {
  it('pipeline run captures a RunRecord with telemetry', async () => {
    const oc = new OpenContext({
      embedder: new DeterministicEmbedder(64),
    });

    const ctx = await oc.createContext({
      name: 'Test',
      description: 'Test context',
    });

    await oc.acquire('Always validate input. Use strict mode.', ctx.id);

    const output = await oc.run({
      query: 'What are the validation rules?',
      contextId: ctx.id,
      profile: 'retrieve-and-process',
    });

    // run() now returns a runId
    expect(output.runId).toBeDefined();

    // RunRecord should be stored
    const record = await oc.metricsStore.getRun(output.runId);
    expect(record).not.toBeNull();
    expect(record!.contextId).toBe(ctx.id);
    expect(record!.profile).toBe('retrieve-and-process');
    expect(record!.steps.length).toBeGreaterThan(0);
    expect(record!.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(record!.unitsRetrieved).toBeGreaterThan(0);

    // Step telemetry should be captured
    const retrieveStep = record!.steps.find((s) => s.stepType === 'retrieve');
    expect(retrieveStep).toBeDefined();
    expect(retrieveStep!.status).toBe('success');
    expect(retrieveStep!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reportOutcome attaches qualified feedback to a run', async () => {
    const oc = new OpenContext({
      embedder: new DeterministicEmbedder(64),
    });

    const ctx = await oc.createContext({
      name: 'Test',
      description: 'Test context',
    });

    await oc.acquire('Use HTTPS for all API calls.', ctx.id);

    const output = await oc.run({
      query: 'Security practices?',
      contextId: ctx.id,
      profile: 'retrieve-and-process',
    });

    // Report a qualified outcome
    const outcome: RunOutcome = {
      runId: output.runId,
      reportedAt: Date.now(),
      reportedBy: 'test-agent',
      success: true,
      quality: 0.7,
      improvements: [
        {
          rank: 1,
          category: 'retrieval',
          description: 'Could include more specific security rules',
          suggestedChange: {
            target: 'scopeRules.parentWeight',
            currentValue: 0.8,
            suggestedValue: 0.9,
          },
        },
        {
          rank: 2,
          category: 'missing-knowledge',
          description: 'No content about CORS configuration',
        },
      ],
      unitFeedback: output.retrievedUnits.length > 0
        ? [
            {
              unitId: output.retrievedUnits[0].unit.id,
              signal: 'helpful',
              detail: 'Directly relevant to the question',
            },
          ]
        : [],
    };

    await oc.reportOutcome(outcome);

    // Verify it's stored and attached
    const record = await oc.metricsStore.getRun(output.runId);
    expect(record!.outcome).toBeDefined();
    expect(record!.outcome!.quality).toBe(0.7);
    expect(record!.outcome!.improvements).toHaveLength(2);
    expect(record!.outcome!.improvements[0].category).toBe('retrieval');
  });

  it('analyzeMetrics produces a report', async () => {
    const oc = new OpenContext({
      embedder: new DeterministicEmbedder(64),
    });

    const ctx = await oc.createContext({
      name: 'Analysis Test',
      description: 'Test analysis',
    });

    await oc.acquire('Rule one. Rule two. Rule three.', ctx.id);

    // Run several times
    for (let i = 0; i < 3; i++) {
      const output = await oc.run({
        query: `Query number ${i}`,
        contextId: ctx.id,
        profile: 'retrieve-and-process',
      });
      await oc.reportOutcome({
        runId: output.runId,
        reportedAt: Date.now(),
        reportedBy: 'test',
        success: i > 0,
        quality: 0.5 + i * 0.1,
        improvements: i === 0
          ? [{ rank: 1, category: 'retrieval', description: 'Improve scope weights' }]
          : [],
        unitFeedback: [],
      });
    }

    const report = await oc.analyzeMetrics();

    expect(report.runCount).toBe(3);
    expect(report.overallSuccessRate).toBeCloseTo(2 / 3, 1);
    expect(report.averageQuality).toBeGreaterThan(0);
    expect(report.contextAnalyses.length).toBeGreaterThan(0);
    expect(report.stepAnalyses.length).toBeGreaterThan(0);

    // Should have aggregated the improvement suggestion
    const suggestions = report.topSuggestions;
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].category).toBe('retrieval');
  });

  it('detectSignals finds repeated queries', async () => {
    const oc = new OpenContext({
      embedder: new DeterministicEmbedder(64),
      implicitSignalConfig: {
        repeatWindowMs: 60_000,
        repeatSimilarityThreshold: 0.5,
      },
    });

    const ctx = await oc.createContext({
      name: 'Signal Test',
      description: 'Test signals',
    });

    await oc.acquire('Some content to retrieve.', ctx.id);

    // Run the same query multiple times
    for (let i = 0; i < 3; i++) {
      await oc.run({
        query: 'What content should I retrieve?',
        contextId: ctx.id,
        profile: 'retrieve-only',
      });
    }

    const signals = await oc.detectSignals();
    const repeated = signals.filter((s) => s.type === 'repeated-query');
    expect(repeated.length).toBeGreaterThan(0);
  });

  it('metrics persist through save/load', async () => {
    const oc = new OpenContext({
      embedder: new DeterministicEmbedder(64),
    });

    const ctx = await oc.createContext({
      name: 'Persist Test',
      description: 'Test persistence',
    });

    await oc.acquire('Persistent content.', ctx.id);

    const output = await oc.run({
      query: 'What is persistent?',
      contextId: ctx.id,
      profile: 'retrieve-and-process',
    });

    await oc.reportOutcome({
      runId: output.runId,
      reportedAt: Date.now(),
      reportedBy: 'test',
      success: true,
      quality: 0.85,
      improvements: [],
      unitFeedback: [],
    });

    const path = './test-metrics-persist-tmp.json';
    await oc.save(path);

    // Load into new instance
    const oc2 = new OpenContext({
      embedder: new DeterministicEmbedder(64),
    });
    await oc2.load(path);

    // Verify metrics were restored
    const record = await oc2.metricsStore.getRun(output.runId);
    expect(record).not.toBeNull();
    expect(record!.outcome).toBeDefined();
    expect(record!.outcome!.quality).toBe(0.85);

    // Cleanup
    const fs = await import('fs/promises');
    await fs.unlink(path).catch(() => {});
  });
});
