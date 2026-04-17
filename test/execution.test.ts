import { describe, it, expect, beforeEach } from 'vitest';
import {
  QueryConstructor,
  parseFeedback,
  extractPrimaryResponse,
  InMemoryFeedbackStore,
  AgentActionExecutor,
  DeterministicEmbedder,
  InMemoryVectorStore,
  InMemoryUnitStore,
  InMemoryContextStore,
  DefaultScopeResolver,
  VectorRetriever,
  NoopAgentAdapter,
  OpenContext,
} from '../src/index.js';
import type {
  ActionDefinition,
  Objective,
  PlanNode,
  AssembledInput,
  AgentOutput,
  AgentAdapter,
} from '../src/index.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAction(overrides?: Partial<ActionDefinition>): ActionDefinition {
  return {
    id: 'test-action',
    name: 'Test Action',
    description: 'A test action that processes something',
    contextId: 'test-ctx',
    inputs: [
      { name: 'data', description: 'Input data', required: true, resourceTypeId: 'DataSet' },
    ],
    outputs: [
      { name: 'response', description: 'The result', required: true },
    ],
    performer: { type: 'agent', agentConfig: { model: 'test-model' } },
    instructions: 'Process the data and produce a result. Follow all relevant guidelines.',
    parameters: [],
    validations: [
      { id: 'v1', description: 'Output must be non-empty', method: 'assertion', expression: 'response', blocking: true },
    ],
    riskIndicators: [],
    maxAttempts: 2,
    tags: ['test'],
    ...overrides,
  };
}

function makeNode(action: ActionDefinition, overrides?: Partial<PlanNode>): PlanNode {
  return {
    id: 'node-1',
    actionId: action.id,
    action,
    status: 'ready',
    attemptCount: 0,
    attempts: [],
    risk: 0.5,
    value: 1,
    expanded: false,
    ...overrides,
  };
}

// ── QueryConstructor Tests ─────────────────────────────────────────────────

describe('QueryConstructor', () => {
  it('constructs queries from action definition', () => {
    const qc = new QueryConstructor();
    const action = makeAction();

    const constructed = qc.construct(action, null, 'test-ctx');

    expect(constructed.actionId).toBe('test-action');
    expect(constructed.contextId).toBe('test-ctx');
    expect(constructed.retrievals.length).toBeGreaterThan(0);

    // Should have at least: primary, instructions, domain, input:data, learnings
    const purposes = constructed.retrievals.map((r) => r.purpose);
    expect(purposes).toContain('primary-context');
    expect(purposes).toContain('instructions-and-rules');
    expect(purposes).toContain('domain-knowledge');
    expect(purposes).toContain('input:data');
    expect(purposes).toContain('learnings');
  });

  it('includes plan context when objective provided', () => {
    const qc = new QueryConstructor();
    const action = makeAction();
    const objective: Objective = {
      id: 'obj-1',
      name: 'Build the thing',
      description: 'Build the thing correctly',
      contextId: 'test-ctx',
      acceptanceCriteria: ['Must pass all tests'],
      isLearningObjective: false,
      priority: 1,
      status: 'executing',
    };

    const constructed = qc.construct(action, objective, 'test-ctx');
    const purposes = constructed.retrievals.map((r) => r.purpose);
    expect(purposes).toContain('plan-context');
  });

  it('retrieval requests are sorted by priority', () => {
    const qc = new QueryConstructor();
    const action = makeAction();
    const constructed = qc.construct(action, null, 'test-ctx');

    for (let i = 1; i < constructed.retrievals.length; i++) {
      expect(constructed.retrievals[i - 1].priority)
        .toBeGreaterThanOrEqual(constructed.retrievals[i].priority);
    }
  });

  it('executes queries and deduplicates results', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    // Add some knowledge
    await oc.acquire('Always validate input data before processing.', ctx.id);
    await oc.acquire('The DataSet format uses JSON with schema validation.', ctx.id);
    await oc.acquire('Previous learning: processing worked best with batch approach.', ctx.id, {
      contentType: 'learning',
    });

    const qc = new QueryConstructor({ maxTotalUnits: 10 });
    const action = makeAction({ contextId: ctx.id });
    const constructed = qc.construct(action, null, ctx.id);

    const retriever = new VectorRetriever({
      embedder: oc.embedder,
      vectorStore: oc.vectorStore,
      unitStore: oc.unitStore,
      contextStore: oc.contextStore,
      scopeResolver: oc.scopeResolver,
    });

    const result = await qc.execute(constructed, retriever);

    expect(result.units.length).toBeGreaterThan(0);
    expect(result.retrievalResults.length).toBe(constructed.retrievals.length);

    // Check deduplication — no duplicate unit IDs
    const ids = result.units.map((u) => u.unit.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── Feedback Protocol Tests ────────────────────────────────────────────────

describe('Feedback Protocol', () => {
  it('parses structured feedback from agent response', () => {
    const response = `Here is my analysis of the data. The results look good.

---FEEDBACK---
{
  "contextQuality": "mostly-sufficient",
  "usedUnits": [{"unitId": "abc123", "usage": "directly-applied", "importance": 0.9}],
  "unusedUnits": [{"unitId": "def456", "reason": "irrelevant"}],
  "missingInformation": [{"description": "No schema documentation provided", "severity": "degraded-quality", "resolution": "inferred"}],
  "additionalQueries": [],
  "actionFeedback": {"instructionQuality": "clear", "inputAccuracy": "accurate", "outputAccuracy": "accurate", "suggestions": []}
}`;

    const feedback = parseFeedback(response, 'action-1', 'node-1');

    expect(feedback).not.toBeNull();
    expect(feedback!.contextQuality).toBe('mostly-sufficient');
    expect(feedback!.usedUnits).toHaveLength(1);
    expect(feedback!.usedUnits[0].unitId).toBe('abc123');
    expect(feedback!.unusedUnits).toHaveLength(1);
    expect(feedback!.missingInformation).toHaveLength(1);
    expect(feedback!.missingInformation[0].severity).toBe('degraded-quality');
    expect(feedback!.actionFeedback?.instructionQuality).toBe('clear');
  });

  it('extracts primary response without feedback', () => {
    const response = `Here is my analysis.

---FEEDBACK---
{"contextQuality": "sufficient", "usedUnits": [], "unusedUnits": [], "missingInformation": [], "additionalQueries": []}`;

    const primary = extractPrimaryResponse(response);
    expect(primary).toBe('Here is my analysis.');
  });

  it('returns null when no feedback marker present', () => {
    const feedback = parseFeedback('Just a normal response.', 'action-1');
    expect(feedback).toBeNull();
  });

  it('handles malformed JSON gracefully', () => {
    const response = '---FEEDBACK---\n{broken json';
    const feedback = parseFeedback(response, 'action-1');
    expect(feedback).toBeNull();
  });

  it('feedback store records and retrieves', async () => {
    const store = new InMemoryFeedbackStore();

    await store.record({
      id: 'f1',
      feedback: {
        actionId: 'action-1',
        timestamp: Date.now(),
        contextQuality: 'sufficient',
        usedUnits: [],
        unusedUnits: [],
        missingInformation: [],
        additionalQueries: [],
      },
      queryRetrievalSummary: [{ purpose: 'primary', query: 'test', unitsReturned: 5 }],
      actionId: 'action-1',
      contextId: 'ctx-1',
      actionOutcome: 'succeeded',
    });

    const byAction = await store.getByAction('action-1');
    expect(byAction).toHaveLength(1);

    const byContext = await store.getByContext('ctx-1');
    expect(byContext).toHaveLength(1);
  });
});

// ── AgentActionExecutor Tests ──────────────────────────────────────────────

describe('AgentActionExecutor', () => {
  it('executes an action with full flow: query → assemble → invoke → feedback', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test context' });

    // Seed with knowledge
    await oc.acquire('Always validate inputs. Use strict mode for TypeScript.', ctx.id);
    await oc.acquire('DataSet entities must have a schema property.', ctx.id, {
      contentType: 'fact',
    });

    // Build a mock agent that returns structured feedback
    const mockAgent: AgentAdapter = {
      async process(input: AssembledInput): Promise<AgentOutput> {
        const unitIds = input.sections
          .flatMap((s) => s.content.match(/id:[a-f0-9]{8}/g) ?? [])
          .map((m) => m.replace('id:', ''));

        return {
          response: `Processed the data successfully. Found ${input.totalUnits} knowledge units.

---FEEDBACK---
{
  "contextQuality": "sufficient",
  "usedUnits": ${JSON.stringify(unitIds.slice(0, 2).map((id: string) => ({ unitId: id, usage: "informed-reasoning", importance: 0.7 })))},
  "unusedUnits": [],
  "missingInformation": [],
  "additionalQueries": []
}`,
          metadata: { model: 'mock' },
        };
      },
    };

    const feedbackStore = new InMemoryFeedbackStore();
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
      feedbackStore,
      { requestFeedback: true },
    );

    const action = makeAction({ contextId: ctx.id });
    const node = makeNode(action);

    const result = await executor.execute(node, { data: 'test input' });

    // Should succeed
    expect(result.error).toBeUndefined();
    expect(result.outputs['response']).toBeDefined();
    expect(typeof result.outputs['response']).toBe('string');

    // Should have execution metadata
    expect(result.executionMeta).toBeDefined();
    expect(result.executionMeta!['queryResult']).toBeDefined();

    // Feedback should be recorded
    const storedFeedback = await feedbackStore.getByAction('test-action');
    expect(storedFeedback).toHaveLength(1);
    expect(storedFeedback[0].feedback.contextQuality).toBe('sufficient');
  });

  it('includes attempt history for retries', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    let assembledContent = '';
    const capturingAgent: AgentAdapter = {
      async process(input: AssembledInput): Promise<AgentOutput> {
        assembledContent = input.sections.map((s) => s.content).join('\n');
        return { response: 'Done.' };
      },
    };

    const executor = new AgentActionExecutor(
      new VectorRetriever({
        embedder: oc.embedder,
        vectorStore: oc.vectorStore,
        unitStore: oc.unitStore,
        contextStore: oc.contextStore,
        scopeResolver: oc.scopeResolver,
      }),
      capturingAgent,
      new InMemoryFeedbackStore(),
      { requestFeedback: false },
    );

    const action = makeAction({ contextId: ctx.id });
    const node = makeNode(action, {
      attemptCount: 1,
      attempts: [{
        attemptNumber: 1,
        startedAt: Date.now() - 1000,
        completedAt: Date.now() - 500,
        status: 'failed',
        error: 'Previous approach did not work',
        outputs: {},
        validationResults: [],
      }],
    });

    await executor.execute(node, {});

    // The assembled context should include previous attempt information
    expect(assembledContent).toContain('Previous Attempts');
    expect(assembledContent).toContain('Previous approach did not work');
    expect(assembledContent).toContain('different approach');
  });

  it('handles agent errors gracefully', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const failingAgent: AgentAdapter = {
      async process(): Promise<AgentOutput> {
        throw new Error('LLM API unavailable');
      },
    };

    const executor = new AgentActionExecutor(
      new VectorRetriever({
        embedder: oc.embedder,
        vectorStore: oc.vectorStore,
        unitStore: oc.unitStore,
        contextStore: oc.contextStore,
        scopeResolver: oc.scopeResolver,
      }),
      failingAgent,
      new InMemoryFeedbackStore(),
    );

    const action = makeAction({ contextId: ctx.id });
    const node = makeNode(action);

    const result = await executor.execute(node, {});
    expect(result.error).toBe('LLM API unavailable');
    expect(result.outputs).toEqual({});
  });
});
