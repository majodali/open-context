/**
 * Live Anthropic API integration tests.
 *
 * These tests hit the real Anthropic API. They are opt-in:
 *   RUN_LIVE_API_TESTS=1 ANTHROPIC_API_KEY=sk-... npx vitest run test/anthropic-adapter-live.test.ts
 *
 * When not opted in, all tests skip.
 * Uses Haiku by default — cheap, fast, captures nondeterminism.
 */

import { describe, it, expect } from 'vitest';
import {
  AnthropicAgentAdapter,
  ToolRegistry,
  AgentActionExecutor,
  InMemoryFeedbackStore,
  OpenContext,
  VectorRetriever,
  createGetUnitDetailTool,
  createQueryKnowledgeTool,
} from '../src/index.js';
import { TransformersEmbedder } from '../src/storage/transformers-embedder.js';
import type {
  AssembledInput,
  ToolDefinition,
  ActionDefinition,
  PlanNode,
} from '../src/index.js';

const RUN_LIVE = process.env['RUN_LIVE_API_TESTS'] === '1';
const HAS_API_KEY = Boolean(process.env['ANTHROPIC_API_KEY']);

// Use describe.skipIf equivalent — conditionally skip the whole suite
const describeMaybe = RUN_LIVE && HAS_API_KEY ? describe : describe.skip;

const DEFAULT_HAIKU_MODEL = 'claude-haiku-4-5';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeInput(sections: { name: string; content: string }[]): AssembledInput {
  return {
    sections,
    totalUnits: 1,
    totalTokensEstimate: sections.reduce((s, x) => s + Math.ceil(x.content.length / 4), 0),
    template: { id: 'test', sections: sections.map((s) => ({ name: s.name })), prioritization: 'relevance' },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describeMaybe('AnthropicAgentAdapter (LIVE API)', () => {
  it('single-shot: returns text response without tools', async () => {
    const adapter = new AnthropicAgentAdapter({
      model: DEFAULT_HAIKU_MODEL,
      maxTokens: 200,
      requestStructuredOutput: false,
    });

    const input = makeInput([
      { name: 'task', content: 'Reply with a single sentence: "The sky is blue."' },
    ]);

    const result = await adapter.process(input);
    expect(result.response).toBeTruthy();
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.metadata?.['model']).toContain('haiku');
    expect(result.metadata?.['outputTokens']).toBeGreaterThan(0);
  }, 60_000);

  it('tool-use: emits tool_use when a useful tool is provided', async () => {
    const adapter = new AnthropicAgentAdapter({
      model: DEFAULT_HAIKU_MODEL,
      maxTokens: 500,
      requestStructuredOutput: false,
    });

    // Give the agent a tool that's obviously useful for the task
    const getWeather: ToolDefinition = {
      name: 'get_weather',
      description: 'Get the current weather for a given city.',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'The city name' },
        },
        required: ['city'],
      },
      execute: async () => ({ success: true, content: 'sunny, 72F' }),
    };

    const input = makeInput([
      {
        name: 'task',
        content:
          'I need to know the current weather in Paris. Use the get_weather tool to find out. ' +
          'Do not fabricate the answer — use the tool.',
      },
    ]);

    const result = await adapter.process(input, [getWeather]);
    // Claude should have either emitted a tool call or done so in text
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBeGreaterThan(0);
    expect(result.toolCalls![0].name).toBe('get_weather');
    expect(result.toolCalls![0].arguments).toHaveProperty('city');
  }, 60_000);

  it('multi-turn: continues conversation after tool result', async () => {
    const adapter = new AnthropicAgentAdapter({
      model: DEFAULT_HAIKU_MODEL,
      maxTokens: 500,
      requestStructuredOutput: false,
    });

    const getWeather: ToolDefinition = {
      name: 'get_weather',
      description: 'Get the current weather for a given city.',
      inputSchema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
      execute: async () => ({ success: true, content: 'sunny, 72F' }),
    };

    const input = makeInput([
      {
        name: 'task',
        content:
          'What is the weather in Paris? Use the get_weather tool, then summarize the result in one sentence.',
      },
    ]);

    // First turn — should call the tool
    const firstTurn = await adapter.process(input, [getWeather]);
    expect(firstTurn.toolCalls).toBeDefined();
    expect(firstTurn.toolCalls!.length).toBeGreaterThan(0);

    // Simulate tool execution
    const toolCall = firstTurn.toolCalls![0];
    const toolResponses = [
      { id: toolCall.id, success: true, content: 'sunny, 72F' },
    ];

    // Continue
    const secondTurn = await adapter.processMultiTurn(
      input,
      [{ output: firstTurn, toolResponses }],
      [getWeather],
    );

    expect(secondTurn.response.toLowerCase()).toMatch(/sunny|72|paris|weather/);
    // Final turn may or may not have tool calls — if it does, that's its choice
  }, 120_000);
});

// ── AgentActionExecutor integration with live agent ───────────────────────

describeMaybe('AgentActionExecutor with live Anthropic (LIVE API)', () => {
  it('full action execution with tools and feedback', async () => {
    const oc = new OpenContext({
      embedder: new TransformersEmbedder({
        model: 'Xenova/bge-small-en-v1.5',
        dimensions: 384,
      }),
    });

    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });
    await oc.acquire(
      'The capital of France is Paris. Paris is home to the Eiffel Tower.',
      ctx.id,
      { tags: ['domain:geography'] },
    );
    await oc.acquire(
      'The capital of Japan is Tokyo. Tokyo has a population of 14 million.',
      ctx.id,
      { tags: ['domain:geography'] },
    );

    const registry = new ToolRegistry();
    registry.register(createGetUnitDetailTool(oc.unitStore));
    registry.register(
      createQueryKnowledgeTool(
        new VectorRetriever({
          embedder: oc.embedder,
          vectorStore: oc.vectorStore,
          unitStore: oc.unitStore,
          contextStore: oc.contextStore,
          scopeResolver: oc.scopeResolver,
        }),
        () => ctx.id,
      ),
    );

    const adapter = new AnthropicAgentAdapter({
      model: DEFAULT_HAIKU_MODEL,
      maxTokens: 800,
    });

    const feedbackStore = new InMemoryFeedbackStore();
    const executor = new AgentActionExecutor(
      new VectorRetriever({
        embedder: oc.embedder,
        vectorStore: oc.vectorStore,
        unitStore: oc.unitStore,
        contextStore: oc.contextStore,
        scopeResolver: oc.scopeResolver,
      }),
      adapter,
      feedbackStore,
      { requestFeedback: true, toolRegistry: registry, maxContextTokens: 4000 },
    );

    const action: ActionDefinition = {
      id: 'answer-geography',
      name: 'Answer Geography Question',
      description: 'Answer a geography question using the knowledge base.',
      contextId: ctx.id,
      inputs: [],
      outputs: [{ name: 'response', description: 'The answer', required: true }],
      performer: { type: 'agent' },
      instructions:
        'Answer the following question concisely using only the knowledge provided: ' +
        'What is the capital of France?',
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
      risk: 0.1,
      value: 1,
      expanded: false,
    };

    const result = await executor.execute(node, {});
    expect(result.error).toBeUndefined();
    expect(result.outputs['response']).toBeTruthy();
    expect(String(result.outputs['response']).toLowerCase()).toContain('paris');

    // Check feedback was captured
    const feedbacks = await feedbackStore.getAll();
    // May or may not have feedback depending on whether Claude returned feedback block
    // Not a hard requirement, but if present should be valid
    if (feedbacks.length > 0) {
      expect(feedbacks[0].actionId).toBe('answer-geography');
    }
  }, 180_000);
});

// ── When tests are skipped, confirm the opt-in path ────────────────────────

describe('Live API test opt-in', () => {
  it('documents opt-in mechanism', () => {
    // This test always runs. It documents how to enable live tests.
    const hint = [
      'Live API tests are opt-in to avoid cost and rate limiting.',
      'To run them: set RUN_LIVE_API_TESTS=1 and ANTHROPIC_API_KEY=sk-...',
      'Current state:',
      `  RUN_LIVE_API_TESTS: ${process.env['RUN_LIVE_API_TESTS'] ?? '(unset)'}`,
      `  ANTHROPIC_API_KEY: ${HAS_API_KEY ? 'set' : '(unset)'}`,
      `  Live tests active: ${RUN_LIVE && HAS_API_KEY ? 'YES' : 'no'}`,
    ].join('\n');
    expect(hint.length).toBeGreaterThan(0);
  });
});
