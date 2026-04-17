import { describe, it, expect } from 'vitest';
import {
  ToolRegistry,
  createUserInputTool,
  DefaultResponseUserInputHandler,
  StrictUserInputHandler,
  QueuedUserInputHandler,
  validateAgainstSchema,
  AgentActionExecutor,
  InMemoryFeedbackStore,
  VectorRetriever,
  OpenContext,
  DeterministicEmbedder,
} from '../src/index.js';
import type {
  ActionDefinition,
  PlanNode,
  AgentAdapter,
  AgentTurn,
  AssembledInput,
  AgentOutput,
  ToolDefinition,
  ToolCallResponse,
} from '../src/index.js';

// ── ToolRegistry tests ─────────────────────────────────────────────────────

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const registry = new ToolRegistry();
    const tool: ToolDefinition = {
      name: 'echo',
      description: 'Echoes input',
      inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
      execute: async (args) => ({ success: true, content: String(args['msg'] ?? '') }),
    };

    registry.register(tool);
    expect(registry.get('echo')).toBeDefined();
    expect(registry.list()).toHaveLength(1);
  });

  it('throws on duplicate registration', () => {
    const registry = new ToolRegistry();
    const tool: ToolDefinition = {
      name: 'echo',
      description: 'Echoes',
      inputSchema: {},
      execute: async () => ({ success: true, content: '' }),
    };
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow(/already registered/);
  });

  it('executes tool calls', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'add',
      description: 'Adds two numbers',
      inputSchema: { type: 'object' },
      execute: async (args) => ({
        success: true,
        content: Number(args['a']) + Number(args['b']),
      }),
    });

    const response = await registry.execute(
      { id: 'call-1', name: 'add', arguments: { a: 2, b: 3 } },
      { actionId: 'a', contextId: 'c' },
    );
    expect(response.success).toBe(true);
    expect(response.content).toBe(5);
    expect(response.id).toBe('call-1');
  });

  it('returns error for unregistered tool', async () => {
    const registry = new ToolRegistry();
    const response = await registry.execute(
      { id: 'call-1', name: 'nonexistent', arguments: {} },
      { actionId: 'a', contextId: 'c' },
    );
    expect(response.success).toBe(false);
    expect(response.error).toContain('not registered');
  });

  it('handles thrown errors gracefully', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'broken',
      description: 'Always throws',
      inputSchema: {},
      execute: async () => { throw new Error('boom'); },
    });
    const response = await registry.execute(
      { id: '1', name: 'broken', arguments: {} },
      { actionId: 'a', contextId: 'c' },
    );
    expect(response.success).toBe(false);
    expect(response.error).toBe('boom');
  });
});

describe('User input tool', () => {
  it('default handler returns the default response', async () => {
    const handler = new DefaultResponseUserInputHandler('default-response');
    const tool = createUserInputTool(handler);
    const result = await tool.execute(
      { question: 'What now?' },
      { actionId: 'a', contextId: 'c' },
    );
    expect(result.success).toBe(true);
    expect(result.content).toBe('default-response');
  });

  it('strict handler throws when called', async () => {
    const handler = new StrictUserInputHandler();
    const tool = createUserInputTool(handler);
    const result = await tool.execute(
      { question: 'What?' },
      { actionId: 'a', contextId: 'c' },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('User input required');
  });

  it('queued handler returns queued responses in order', async () => {
    const handler = new QueuedUserInputHandler(['first', 'second']);
    const tool = createUserInputTool(handler);

    const r1 = await tool.execute({ question: 'q1' }, { actionId: 'a', contextId: 'c' });
    const r2 = await tool.execute({ question: 'q2' }, { actionId: 'a', contextId: 'c' });

    expect(r1.content).toBe('first');
    expect(r2.content).toBe('second');
    expect(handler.questions).toEqual(['q1', 'q2']);
  });

  it('rejects empty question', async () => {
    const tool = createUserInputTool(new DefaultResponseUserInputHandler());
    const result = await tool.execute({}, { actionId: 'a', contextId: 'c' });
    expect(result.success).toBe(false);
  });
});

// ── JSON schema validation tests ──────────────────────────────────────────

describe('validateAgainstSchema', () => {
  it('validates basic types', () => {
    expect(validateAgainstSchema('hello', { type: 'string' }).valid).toBe(true);
    expect(validateAgainstSchema(42, { type: 'number' }).valid).toBe(true);
    expect(validateAgainstSchema(true, { type: 'boolean' }).valid).toBe(true);
    expect(validateAgainstSchema([], { type: 'array' }).valid).toBe(true);
    expect(validateAgainstSchema({}, { type: 'object' }).valid).toBe(true);
    expect(validateAgainstSchema(null, { type: 'null' }).valid).toBe(true);

    expect(validateAgainstSchema('hello', { type: 'number' }).valid).toBe(false);
    expect(validateAgainstSchema([], { type: 'object' }).valid).toBe(false);
  });

  it('checks required properties', () => {
    const schema = {
      type: 'object',
      required: ['name', 'age'],
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    };

    expect(validateAgainstSchema({ name: 'Alice', age: 30 }, schema).valid).toBe(true);
    const result = validateAgainstSchema({ name: 'Alice' }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('age');
  });

  it('validates nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            email: { type: 'string' },
          },
          required: ['email'],
        },
      },
    };

    expect(validateAgainstSchema({ user: { email: 'a@b.c' } }, schema).valid).toBe(true);
    expect(validateAgainstSchema({ user: {} }, schema).valid).toBe(false);
  });

  it('validates arrays', () => {
    const schema = {
      type: 'array',
      items: { type: 'number' },
    };
    expect(validateAgainstSchema([1, 2, 3], schema).valid).toBe(true);
    expect(validateAgainstSchema([1, 'two', 3], schema).valid).toBe(false);
  });

  it('validates enums', () => {
    const schema = { enum: ['red', 'green', 'blue'] };
    expect(validateAgainstSchema('red', schema).valid).toBe(true);
    expect(validateAgainstSchema('purple', schema).valid).toBe(false);
  });

  it('validates string length constraints', () => {
    const schema = { type: 'string', minLength: 3, maxLength: 10 };
    expect(validateAgainstSchema('hello', schema).valid).toBe(true);
    expect(validateAgainstSchema('hi', schema).valid).toBe(false);
    expect(validateAgainstSchema('this is too long', schema).valid).toBe(false);
  });

  it('validates number range', () => {
    const schema = { type: 'number', minimum: 0, maximum: 100 };
    expect(validateAgainstSchema(50, schema).valid).toBe(true);
    expect(validateAgainstSchema(-1, schema).valid).toBe(false);
    expect(validateAgainstSchema(101, schema).valid).toBe(false);
  });

  it('rejects unknown properties when additionalProperties is false', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    };
    expect(validateAgainstSchema({ name: 'a' }, schema).valid).toBe(true);
    expect(validateAgainstSchema({ name: 'a', extra: 1 }, schema).valid).toBe(false);
  });
});

// ── Multi-turn agent execution tests ─────────────────────────────────────

function makeAction(overrides?: Partial<ActionDefinition>): ActionDefinition {
  return {
    id: 'test-action',
    name: 'Test Action',
    description: 'A test action',
    contextId: 'test-ctx',
    inputs: [],
    outputs: [{ name: 'response', description: 'The result', required: true }],
    performer: { type: 'agent' },
    instructions: 'Do the thing.',
    parameters: [],
    validations: [],
    riskIndicators: [],
    maxAttempts: 1,
    tags: [],
    ...overrides,
  };
}

function makeNode(action: ActionDefinition): PlanNode {
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
  };
}

describe('Multi-turn agent execution', () => {
  it('completes single-shot when no tool calls', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const adapter: AgentAdapter = {
      async process() {
        return { response: 'Direct response, no tools needed.' };
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
      adapter,
      new InMemoryFeedbackStore(),
      { requestFeedback: false },
    );

    const action = makeAction({ contextId: ctx.id });
    const result = await executor.execute(makeNode(action), {});

    expect(result.error).toBeUndefined();
    expect(result.outputs['response']).toContain('Direct response');
    expect(result.executionMeta?.['turnCount']).toBe(0);
    expect(result.executionMeta?.['totalToolCalls']).toBe(0);
  });

  it('executes tool calls in multi-turn loop', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const registry = new ToolRegistry();
    registry.register({
      name: 'lookup',
      description: 'Look up data',
      inputSchema: { type: 'object' },
      execute: async (args) => ({
        success: true,
        content: `value-for-${args['key']}`,
      }),
    });

    let turnCount = 0;
    const adapter: AgentAdapter = {
      async process(): Promise<AgentOutput> {
        turnCount++;
        // First turn: request a tool call
        return {
          response: 'Need to look this up',
          toolCalls: [{ id: 't1', name: 'lookup', arguments: { key: 'foo' } }],
        };
      },
      async processMultiTurn(_input, history): Promise<AgentOutput> {
        turnCount++;
        // Second turn: have the tool result, give final response
        const toolResult = history[0].toolResponses[0].content;
        return {
          response: `Got result: ${toolResult}`,
        };
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
      adapter,
      new InMemoryFeedbackStore(),
      { requestFeedback: false, toolRegistry: registry },
    );

    const action = makeAction({ contextId: ctx.id });
    const result = await executor.execute(makeNode(action), {});

    expect(result.error).toBeUndefined();
    expect(result.outputs['response']).toContain('value-for-foo');
    expect(turnCount).toBe(2);
    expect(result.executionMeta?.['turnCount']).toBe(1);
    expect(result.executionMeta?.['totalToolCalls']).toBe(1);
  });

  it('respects maxToolCallRounds', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const registry = new ToolRegistry();
    registry.register({
      name: 'noop',
      description: 'Noop',
      inputSchema: { type: 'object' },
      execute: async () => ({ success: true, content: 'ok' }),
    });

    // Adapter that always wants more tool calls
    let invocations = 0;
    const adapter: AgentAdapter = {
      async process(): Promise<AgentOutput> {
        invocations++;
        return {
          response: 'Need more',
          toolCalls: [{ id: `t${invocations}`, name: 'noop', arguments: {} }],
        };
      },
      async processMultiTurn(): Promise<AgentOutput> {
        invocations++;
        return {
          response: 'Still need more',
          toolCalls: [{ id: `t${invocations}`, name: 'noop', arguments: {} }],
        };
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
      adapter,
      new InMemoryFeedbackStore(),
      { requestFeedback: false, toolRegistry: registry, maxToolCallRounds: 3 },
    );

    const action = makeAction({ contextId: ctx.id });
    const result = await executor.execute(makeNode(action), {});

    expect(result.error).toBeUndefined();
    // Initial process + 3 multi-turn rounds = 4 invocations
    expect(invocations).toBe(4);
    expect(result.executionMeta?.['turnCount']).toBe(3);
  });
});

// ── Output schema validation tests ───────────────────────────────────────

describe('Output schema validation', () => {
  it('validates structured output against action schema', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const adapter: AgentAdapter = {
      async process(): Promise<AgentOutput> {
        return {
          response: '```json\n{"score": 0.8, "reasoning": "looks good"}\n```',
        };
      },
    };

    const action = makeAction({
      contextId: ctx.id,
      outputs: [
        { name: 'score', description: 'A score', required: true },
        { name: 'reasoning', description: 'Why', required: true },
      ],
      outputSchema: {
        type: 'object',
        required: ['score', 'reasoning'],
        properties: {
          score: { type: 'number', minimum: 0, maximum: 1 },
          reasoning: { type: 'string' },
        },
      },
    });

    const executor = new AgentActionExecutor(
      new VectorRetriever({
        embedder: oc.embedder,
        vectorStore: oc.vectorStore,
        unitStore: oc.unitStore,
        contextStore: oc.contextStore,
        scopeResolver: oc.scopeResolver,
      }),
      adapter,
      new InMemoryFeedbackStore(),
      { requestFeedback: false },
    );

    const result = await executor.execute(makeNode(action), {});

    expect(result.error).toBeUndefined();
    expect(result.outputs['score']).toBe(0.8);
    expect(result.outputs['reasoning']).toBe('looks good');

    // Implicit schema validation should pass
    const schemaValidation = result.validationResults.find(
      (v) => v.validationId === '__output-schema',
    );
    expect(schemaValidation).toBeDefined();
    expect(schemaValidation!.passed).toBe(true);
  });

  it('reports schema validation failure', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const adapter: AgentAdapter = {
      async process(): Promise<AgentOutput> {
        // Returns something that doesn't match schema (score out of range)
        return {
          response: '```json\n{"score": 5.0, "reasoning": "bad"}\n```',
        };
      },
    };

    const action = makeAction({
      contextId: ctx.id,
      outputs: [{ name: 'score', description: 'A score', required: true }],
      outputSchema: {
        type: 'object',
        required: ['score'],
        properties: {
          score: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    });

    const executor = new AgentActionExecutor(
      new VectorRetriever({
        embedder: oc.embedder,
        vectorStore: oc.vectorStore,
        unitStore: oc.unitStore,
        contextStore: oc.contextStore,
        scopeResolver: oc.scopeResolver,
      }),
      adapter,
      new InMemoryFeedbackStore(),
      { requestFeedback: false },
    );

    const result = await executor.execute(makeNode(action), {});
    const schemaValidation = result.validationResults.find(
      (v) => v.validationId === '__output-schema',
    );
    expect(schemaValidation).toBeDefined();
    expect(schemaValidation!.passed).toBe(false);
    expect(schemaValidation!.detail).toContain('maximum');
  });

  it('runs explicit schema validations from action', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const adapter: AgentAdapter = {
      async process(): Promise<AgentOutput> {
        return {
          response: '```json\n{"items": ["a", "b", "c"]}\n```',
        };
      },
    };

    const action = makeAction({
      contextId: ctx.id,
      outputs: [{ name: 'items', description: 'Items', required: true }],
      outputSchema: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'string' } },
        },
      },
      validations: [
        {
          id: 'v-min-items',
          description: 'At least one item',
          method: 'schema',
          schema: {
            type: 'object',
            properties: { items: { type: 'array' } },
            required: ['items'],
          },
          blocking: true,
        },
      ],
    });

    const executor = new AgentActionExecutor(
      new VectorRetriever({
        embedder: oc.embedder,
        vectorStore: oc.vectorStore,
        unitStore: oc.unitStore,
        contextStore: oc.contextStore,
        scopeResolver: oc.scopeResolver,
      }),
      adapter,
      new InMemoryFeedbackStore(),
      { requestFeedback: false },
    );

    const result = await executor.execute(makeNode(action), {});
    const schemaCheck = result.validationResults.find((v) => v.validationId === 'v-min-items');
    expect(schemaCheck).toBeDefined();
    expect(schemaCheck!.passed).toBe(true);
  });
});
