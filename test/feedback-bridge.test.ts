import { describe, it, expect } from 'vitest';
import {
  OpenContext,
  DeterministicEmbedder,
  InMemoryTrainingDataStore,
  InMemoryFeedbackStore,
  VectorRetriever,
  AgentActionExecutor,
  recordFeedbackAsTraining,
} from '../src/index.js';
import type {
  ExecutionFeedback,
  FeedbackBridgeContext,
  SemanticUnit,
  PlanNode,
  ActionDefinition,
  AgentAdapter,
  AgentOutput,
  AssembledInput,
} from '../src/index.js';

// ── Bridge: direct use ─────────────────────────────────────────────────────

describe('Feedback bridge: recordFeedbackAsTraining', () => {
  async function setup() {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });
    const units = await oc.acquire(
      'Authentication uses JWT tokens. Always validate the signature.',
      ctx.id,
      { tags: ['domain:auth'] },
    );
    const auth = units[0];

    const units2 = await oc.acquire(
      'Database schema uses PostgreSQL with UUID primary keys.',
      ctx.id,
      { tags: ['domain:database'] },
    );
    const db = units2[0];

    return { oc, ctx, auth, db };
  }

  function makeFeedback(partial: Partial<ExecutionFeedback>): ExecutionFeedback {
    return {
      actionId: 'test-action',
      timestamp: Date.now(),
      contextQuality: 'sufficient',
      usedUnits: [],
      unusedUnits: [],
      missingInformation: [],
      subsequentQueries: [],
      foundViaFollowUp: [],
      failureToFind: [],
      ...partial,
    };
  }

  it('converts usedUnits into relevant training examples', async () => {
    const { oc, ctx, auth } = await setup();
    const store = new InMemoryTrainingDataStore();

    const feedback = makeFeedback({
      usedUnits: [
        { unitId: auth.id, usage: 'directly-applied', importance: 0.9 },
      ],
    });

    const context: FeedbackBridgeContext = {
      query: 'how to validate JWT tokens',
      queryTags: ['domain:auth'],
      contextId: ctx.id,
    };

    const result = await recordFeedbackAsTraining(feedback, context, {
      unitStore: oc.unitStore,
      embedder: oc.embedder,
      trainingDataStore: store,
    });

    expect(result.recorded).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.bySource['agent-used']).toBe(1);

    const examples = await store.getAll();
    expect(examples).toHaveLength(1);
    expect(examples[0].label).toBe('relevant');
    expect(examples[0].relevanceScore).toBe(0.9);
    expect(examples[0].source).toBe('agent-used');
    expect(examples[0].unitId).toBe(auth.id);
    expect(examples[0].features.vectorSimilarity).toBeGreaterThanOrEqual(0);
    expect(examples[0].features.vectorSimilarity).toBeLessThanOrEqual(1);
  });

  it('converts unusedUnits into irrelevant training examples', async () => {
    const { oc, ctx, db } = await setup();
    const store = new InMemoryTrainingDataStore();

    const feedback = makeFeedback({
      unusedUnits: [
        { unitId: db.id, reason: 'irrelevant', detail: 'question was about auth' },
      ],
    });

    const result = await recordFeedbackAsTraining(
      feedback,
      { query: 'auth tokens', queryTags: ['domain:auth'], contextId: ctx.id },
      { unitStore: oc.unitStore, embedder: oc.embedder, trainingDataStore: store },
    );

    expect(result.recorded).toBe(1);
    expect(result.bySource['agent-unused']).toBe(1);

    const examples = await store.getAll();
    expect(examples[0].label).toBe('irrelevant');
    expect(examples[0].relevanceScore).toBe(0);
    expect(examples[0].source).toBe('agent-unused');
  });

  it('converts foundViaFollowUp into agent-follow-up examples', async () => {
    const { oc, ctx, auth } = await setup();
    const store = new InMemoryTrainingDataStore();

    const feedback = makeFeedback({
      foundViaFollowUp: [
        {
          unitId: auth.id,
          viaQuery: 'JWT signing algorithm',
          importance: 0.8,
          detail: 'should have been in initial context',
        },
      ],
    });

    const result = await recordFeedbackAsTraining(
      feedback,
      { query: 'implement login', queryTags: ['auth'], contextId: ctx.id },
      { unitStore: oc.unitStore, embedder: oc.embedder, trainingDataStore: store },
    );

    expect(result.recorded).toBe(1);
    expect(result.bySource['agent-follow-up']).toBe(1);

    const examples = await store.getAll();
    expect(examples[0].label).toBe('relevant');
    expect(examples[0].source).toBe('agent-follow-up');
    expect(examples[0].relevanceScore).toBe(0.8);
  });

  it('handles all feedback types in one call', async () => {
    const { oc, ctx, auth, db } = await setup();
    const store = new InMemoryTrainingDataStore();

    const feedback = makeFeedback({
      usedUnits: [{ unitId: auth.id, usage: 'directly-applied', importance: 1.0 }],
      unusedUnits: [{ unitId: db.id, reason: 'wrong-context' }],
    });

    const result = await recordFeedbackAsTraining(
      feedback,
      { query: 'token validation', queryTags: [], contextId: ctx.id },
      { unitStore: oc.unitStore, embedder: oc.embedder, trainingDataStore: store },
    );

    expect(result.recorded).toBe(2);
    expect(result.bySource['agent-used']).toBe(1);
    expect(result.bySource['agent-unused']).toBe(1);
  });

  it('resolves unit IDs by 8-char prefix', async () => {
    const { oc, ctx, auth } = await setup();
    const store = new InMemoryTrainingDataStore();
    const prefix = auth.id.substring(0, 8);

    const feedback = makeFeedback({
      usedUnits: [{ unitId: prefix, usage: 'informed-reasoning', importance: 0.7 }],
    });

    const result = await recordFeedbackAsTraining(
      feedback,
      { query: 'q', queryTags: [], contextId: ctx.id },
      { unitStore: oc.unitStore, embedder: oc.embedder, trainingDataStore: store },
    );

    expect(result.recorded).toBe(1);
    const examples = await store.getAll();
    expect(examples[0].unitId).toBe(auth.id); // Resolved to full ID
  });

  it('strips "id:" prefix that some agents use', async () => {
    const { oc, ctx, auth } = await setup();
    const store = new InMemoryTrainingDataStore();

    const feedback = makeFeedback({
      usedUnits: [
        { unitId: `id:${auth.id.substring(0, 8)}`, usage: 'directly-applied', importance: 0.8 },
      ],
    });

    const result = await recordFeedbackAsTraining(
      feedback,
      { query: 'q', queryTags: [], contextId: ctx.id },
      { unitStore: oc.unitStore, embedder: oc.embedder, trainingDataStore: store },
    );

    expect(result.recorded).toBe(1);
  });

  it('skips unknown unit references and counts them', async () => {
    const { oc, ctx } = await setup();
    const store = new InMemoryTrainingDataStore();

    const feedback = makeFeedback({
      usedUnits: [
        { unitId: 'unknown-unit-id', usage: 'informed-reasoning', importance: 0.5 },
      ],
    });

    const result = await recordFeedbackAsTraining(
      feedback,
      { query: 'q', queryTags: [], contextId: ctx.id },
      { unitStore: oc.unitStore, embedder: oc.embedder, trainingDataStore: store },
    );

    expect(result.recorded).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('dedupes a unit that appears in multiple feedback categories', async () => {
    const { oc, ctx, auth } = await setup();
    const store = new InMemoryTrainingDataStore();

    // Unit appears as both used AND (erroneously) as unused
    // The dedupe should only record the first occurrence (used)
    const feedback = makeFeedback({
      usedUnits: [{ unitId: auth.id, usage: 'directly-applied', importance: 0.9 }],
      unusedUnits: [{ unitId: auth.id, reason: 'redundant' }],
    });

    const result = await recordFeedbackAsTraining(
      feedback,
      { query: 'q', queryTags: [], contextId: ctx.id },
      { unitStore: oc.unitStore, embedder: oc.embedder, trainingDataStore: store },
    );

    expect(result.recorded).toBe(1); // Only one example emitted
    const examples = await store.getAll();
    expect(examples[0].label).toBe('relevant'); // usedUnits processed first
  });

  it('computed vectorSimilarity is consistent with current embedder', async () => {
    const { oc, ctx, auth } = await setup();
    const store = new InMemoryTrainingDataStore();

    const feedback = makeFeedback({
      usedUnits: [{ unitId: auth.id, usage: 'directly-applied', importance: 1.0 }],
    });

    // Using the exact content of the unit as the query — should yield very high similarity
    await recordFeedbackAsTraining(
      feedback,
      {
        query: 'Authentication uses JWT tokens. Always validate the signature.',
        queryTags: [],
        contextId: ctx.id,
      },
      { unitStore: oc.unitStore, embedder: oc.embedder, trainingDataStore: store },
    );

    const examples = await store.getAll();
    // DeterministicEmbedder isn't semantic, but identical text should yield identical vectors
    expect(examples[0].features.vectorSimilarity).toBeCloseTo(1.0, 1);
  });
});

// ── Integration: bridge wired into AgentActionExecutor ────────────────────

describe('AgentActionExecutor integration with feedback bridge', () => {
  it('auto-records training examples when trainingBridge is configured', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    await oc.acquire('Fact A about authentication', ctx.id, { tags: ['domain:auth'] });
    await oc.acquire('Fact B about databases', ctx.id, { tags: ['domain:db'] });

    const allUnits = await oc.unitStore.getAll();
    const factA = allUnits.find((u) => u.content.includes('Fact A'))!;
    const factB = allUnits.find((u) => u.content.includes('Fact B'))!;

    // Agent that reports structured feedback
    const mockAgent: AgentAdapter = {
      async process(input: AssembledInput): Promise<AgentOutput> {
        return {
          response: `Processed the task.

---FEEDBACK---
{
  "contextQuality": "mostly-sufficient",
  "usedUnits": [
    {"unitId": "${factA.id.substring(0, 8)}", "usage": "directly-applied", "importance": 0.9}
  ],
  "unusedUnits": [
    {"unitId": "${factB.id.substring(0, 8)}", "reason": "wrong-context"}
  ],
  "missingInformation": [],
  "subsequentQueries": [],
  "foundViaFollowUp": [],
  "failureToFind": []
}`,
        };
      },
    };

    const retriever = new VectorRetriever({
      embedder: oc.embedder,
      vectorStore: oc.vectorStore,
      unitStore: oc.unitStore,
      contextStore: oc.contextStore,
      scopeResolver: oc.scopeResolver,
    });

    const feedbackStore = new InMemoryFeedbackStore();
    const trainingDataStore = new InMemoryTrainingDataStore();

    const executor = new AgentActionExecutor(
      retriever,
      mockAgent,
      feedbackStore,
      {
        requestFeedback: true,
        trainingBridge: {
          trainingDataStore,
          unitStore: oc.unitStore,
          embedder: oc.embedder,
        },
      },
    );

    const action: ActionDefinition = {
      id: 'test-action',
      name: 'Test',
      description: 'Find relevant auth information',
      contextId: ctx.id,
      inputs: [],
      outputs: [{ name: 'response', description: 'answer', required: true }],
      performer: { type: 'agent' },
      instructions: 'Find auth info',
      parameters: [],
      validations: [],
      riskIndicators: [],
      maxAttempts: 1,
      tags: [],
    };

    const node: PlanNode = {
      id: 'node-1',
      actionId: action.id,
      action,
      status: 'ready',
      attemptCount: 0,
      attempts: [],
      risk: 0.5,
      value: 1,
      expanded: false,
    };

    const result = await executor.execute(node, {});

    // Agent ran successfully
    expect(result.error).toBeUndefined();

    // Feedback was stored
    const feedbacks = await feedbackStore.getAll();
    expect(feedbacks).toHaveLength(1);

    // Training examples were generated
    const examples = await trainingDataStore.getAll();
    expect(examples).toHaveLength(2);
    const relevant = examples.find((e) => e.label === 'relevant');
    const irrelevant = examples.find((e) => e.label === 'irrelevant');
    expect(relevant).toBeDefined();
    expect(irrelevant).toBeDefined();
    expect(relevant!.unitId).toBe(factA.id);
    expect(irrelevant!.unitId).toBe(factB.id);

    // Execution meta reports bridge results
    const trainingBridge = (result.executionMeta as any)?.trainingBridge;
    expect(trainingBridge).toBeDefined();
    expect(trainingBridge.recorded).toBe(2);
    expect(trainingBridge.skipped).toBe(0);
  });

  it('does not record when trainingBridge is not configured', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });
    await oc.acquire('Some content', ctx.id);

    const mockAgent: AgentAdapter = {
      async process(): Promise<AgentOutput> {
        return { response: 'Done.' };
      },
    };

    const retriever = new VectorRetriever({
      embedder: oc.embedder,
      vectorStore: oc.vectorStore,
      unitStore: oc.unitStore,
      contextStore: oc.contextStore,
      scopeResolver: oc.scopeResolver,
    });

    const executor = new AgentActionExecutor(
      retriever,
      mockAgent,
      new InMemoryFeedbackStore(),
      { requestFeedback: false },
    );

    const action: ActionDefinition = {
      id: 't',
      name: 't',
      description: 't',
      contextId: ctx.id,
      inputs: [],
      outputs: [{ name: 'response', description: 'r', required: true }],
      performer: { type: 'agent' },
      instructions: 'Do.',
      parameters: [],
      validations: [],
      riskIndicators: [],
      maxAttempts: 1,
      tags: [],
    };

    const node: PlanNode = {
      id: 'n1',
      actionId: action.id,
      action,
      status: 'ready',
      attemptCount: 0,
      attempts: [],
      risk: 0.5,
      value: 1,
      expanded: false,
    };

    const result = await executor.execute(node, {});
    expect(result.error).toBeUndefined();

    // No bridge configured, so trainingBridge field in meta should be null
    const meta = result.executionMeta as any;
    expect(meta?.trainingBridge).toBeNull();
  });
});
