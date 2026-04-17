import { describe, it, expect } from 'vitest';
import { DAGEngine } from '../src/execution/dag-engine.js';
import type { ActionExecutor, DAGValidationError } from '../src/execution/dag-engine.js';
import type {
  PlanDAG,
  PlanNode,
  PlanEdge,
  ExternalInput,
  ValidationResult,
} from '../src/execution/plan-dag.js';
import type { ActionDefinition } from '../src/execution/action-model.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAction(id: string, inputs: string[], outputs: string[]): ActionDefinition {
  return {
    id,
    name: id,
    description: `Action ${id}`,
    contextId: 'test-ctx',
    inputs: inputs.map((name) => ({ name, description: name, required: true })),
    outputs: outputs.map((name) => ({ name, description: name, required: true })),
    performer: { type: 'tool', toolConfig: { toolName: 'test' } },
    instructions: `Do ${id}`,
    parameters: [],
    validations: [],
    riskIndicators: [],
    maxAttempts: 1,
    tags: [],
  };
}

function makeNode(id: string, action: ActionDefinition, overrides?: Partial<PlanNode>): PlanNode {
  return {
    id,
    actionId: action.id,
    action,
    status: 'pending',
    attemptCount: 0,
    attempts: [],
    risk: 0.5,
    value: 1,
    expanded: false,
    ...overrides,
  };
}

function makeEdge(from: string, fromOutput: string, to: string, toInput: string): PlanEdge {
  return {
    id: `${from}-${to}`,
    sourceNodeId: from,
    sourceOutput: fromOutput,
    targetNodeId: to,
    targetInput: toInput,
  };
}

function makeDag(
  nodes: PlanNode[],
  edges: PlanEdge[],
  externalInputs: ExternalInput[] = [],
): PlanDAG {
  const nodeMap = new Map<string, PlanNode>();
  for (const n of nodes) nodeMap.set(n.id, n);
  return {
    id: 'test-dag',
    objectiveId: 'test-obj',
    contextId: 'test-ctx',
    nodes: nodeMap,
    edges,
    externalInputs,
    assumptions: [],
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'draft',
  };
}

/** Simple executor that succeeds and returns inputs as outputs. */
const passThroughExecutor: ActionExecutor = {
  async execute(node, inputs) {
    const outputs: Record<string, unknown> = {};
    for (const out of node.action?.outputs ?? []) {
      outputs[out.name] = `output-from-${node.id}`;
    }
    return { outputs, validationResults: [] };
  },
};

/** Executor that fails every time. */
const failingExecutor: ActionExecutor = {
  async execute() {
    return {
      outputs: {},
      validationResults: [],
      error: 'Intentional failure',
    };
  },
};

// ── Validation Tests ───────────────────────────────────────────────────────

describe('DAGEngine: validation', () => {
  const engine = new DAGEngine();

  it('valid linear DAG passes validation', () => {
    const a1 = makeAction('act-a', [], ['data']);
    const a2 = makeAction('act-b', ['data'], ['result']);
    const n1 = makeNode('n1', a1);
    const n2 = makeNode('n2', a2);

    const dag = makeDag(
      [n1, n2],
      [makeEdge('n1', 'data', 'n2', 'data')],
    );

    const errors = engine.validate(dag);
    expect(errors).toHaveLength(0);
  });

  it('detects dangling inputs', () => {
    const a1 = makeAction('act-a', ['missing-input'], ['data']);
    const n1 = makeNode('n1', a1);

    const dag = makeDag([n1], []);
    const errors = engine.validate(dag);

    const dangling = errors.filter((e) => e.type === 'dangling-input');
    expect(dangling.length).toBeGreaterThan(0);
    expect(dangling[0].message).toContain('missing-input');
  });

  it('accepts external inputs', () => {
    const a1 = makeAction('act-a', ['ext-data'], ['result']);
    const n1 = makeNode('n1', a1);

    const dag = makeDag([n1], [], [
      {
        targetNodeId: 'n1',
        targetInput: 'ext-data',
        description: 'External data',
        available: true,
      },
    ]);

    const errors = engine.validate(dag);
    expect(errors).toHaveLength(0);
  });

  it('detects cycles', () => {
    const a1 = makeAction('act-a', ['in'], ['out']);
    const a2 = makeAction('act-b', ['in'], ['out']);
    const n1 = makeNode('n1', a1);
    const n2 = makeNode('n2', a2);

    const dag = makeDag(
      [n1, n2],
      [
        makeEdge('n1', 'out', 'n2', 'in'),
        makeEdge('n2', 'out', 'n1', 'in'),
      ],
    );

    const errors = engine.validate(dag);
    expect(errors.some((e) => e.type === 'cycle')).toBe(true);
  });

  it('detects self-loops', () => {
    const a1 = makeAction('act-a', ['in'], ['out']);
    const n1 = makeNode('n1', a1);

    const dag = makeDag(
      [n1],
      [makeEdge('n1', 'out', 'n1', 'in')],
    );

    const errors = engine.validate(dag);
    expect(errors.some((e) => e.type === 'self-loop')).toBe(true);
  });

  it('detects duplicate edges', () => {
    const a1 = makeAction('act-a', [], ['data']);
    const a2 = makeAction('act-b', ['data'], []);
    const n1 = makeNode('n1', a1);
    const n2 = makeNode('n2', a2);

    const dag = makeDag(
      [n1, n2],
      [
        makeEdge('n1', 'data', 'n2', 'data'),
        { id: 'dup', sourceNodeId: 'n1', sourceOutput: 'data', targetNodeId: 'n2', targetInput: 'data' },
      ],
    );

    const errors = engine.validate(dag);
    expect(errors.some((e) => e.type === 'duplicate-edge')).toBe(true);
  });

  it('validateAndSeal sets status to valid', () => {
    const a1 = makeAction('act-a', [], ['data']);
    const n1 = makeNode('n1', a1);
    const dag = makeDag([n1], []);

    const errors = engine.validateAndSeal(dag);
    expect(errors).toHaveLength(0);
    expect(dag.status).toBe('valid');
  });
});

// ── Execution Tests ────────────────────────────────────────────────────────

describe('DAGEngine: execution', () => {
  const engine = new DAGEngine();

  it('executes a linear DAG in order', async () => {
    const a1 = makeAction('act-a', [], ['data']);
    const a2 = makeAction('act-b', ['data'], ['result']);
    const n1 = makeNode('n1', a1);
    const n2 = makeNode('n2', a2);

    const dag = makeDag([n1, n2], [makeEdge('n1', 'data', 'n2', 'data')]);
    engine.validateAndSeal(dag);

    const executionOrder: string[] = [];
    const trackingExecutor: ActionExecutor = {
      async execute(node, inputs) {
        executionOrder.push(node.id);
        const outputs: Record<string, unknown> = {};
        for (const out of node.action?.outputs ?? []) {
          outputs[out.name] = `from-${node.id}`;
        }
        return { outputs, validationResults: [] };
      },
    };

    await engine.executePlan(dag, trackingExecutor);

    expect(executionOrder).toEqual(['n1', 'n2']);
    expect(dag.status).toBe('completed');
    expect(dag.nodes.get('n1')!.status).toBe('completed');
    expect(dag.nodes.get('n2')!.status).toBe('completed');
  });

  it('executes diamond DAG correctly', async () => {
    //   n1
    //  / \
    // n2  n3
    //  \ /
    //   n4
    const a1 = makeAction('a1', [], ['out']);
    const a2 = makeAction('a2', ['in'], ['out']);
    const a3 = makeAction('a3', ['in'], ['out']);
    const a4 = makeAction('a4', ['in1', 'in2'], ['result']);

    const dag = makeDag(
      [makeNode('n1', a1), makeNode('n2', a2), makeNode('n3', a3), makeNode('n4', a4)],
      [
        makeEdge('n1', 'out', 'n2', 'in'),
        makeEdge('n1', 'out', 'n3', 'in'),
        makeEdge('n2', 'out', 'n4', 'in1'),
        makeEdge('n3', 'out', 'n4', 'in2'),
      ],
    );
    engine.validateAndSeal(dag);

    await engine.executePlan(dag, passThroughExecutor);

    expect(dag.status).toBe('completed');
    // n4 should have executed after both n2 and n3
    const n4 = dag.nodes.get('n4')!;
    expect(n4.status).toBe('completed');
    expect(n4.attempts).toHaveLength(1);
  });

  it('handles node failure correctly', async () => {
    const a1 = makeAction('act-a', [], ['data']);
    const a2 = makeAction('act-b', ['data'], ['result']);
    const n1 = makeNode('n1', a1);
    const n2 = makeNode('n2', a2);

    const dag = makeDag([n1, n2], [makeEdge('n1', 'data', 'n2', 'data')]);
    engine.validateAndSeal(dag);

    const failFirstExecutor: ActionExecutor = {
      async execute(node) {
        if (node.id === 'n1') {
          return { outputs: {}, validationResults: [], error: 'Failed!' };
        }
        return { outputs: { result: 'ok' }, validationResults: [] };
      },
    };

    await engine.executePlan(dag, failFirstExecutor);

    expect(dag.nodes.get('n1')!.status).toBe('failed');
    // n2 should never have executed (input not available)
    expect(dag.nodes.get('n2')!.status).toBe('pending');
    expect(dag.status).toBe('failed');
  });

  it('retries nodes up to maxAttempts', async () => {
    const action = makeAction('act-a', [], ['data']);
    action.maxAttempts = 3;
    const n1 = makeNode('n1', action);

    const dag = makeDag([n1], []);
    engine.validateAndSeal(dag);

    let callCount = 0;
    const eventualSuccess: ActionExecutor = {
      async execute() {
        callCount++;
        if (callCount < 3) {
          return { outputs: {}, validationResults: [], error: 'Not yet' };
        }
        return { outputs: { data: 'done' }, validationResults: [] };
      },
    };

    await engine.executePlan(dag, eventualSuccess);

    expect(callCount).toBe(3);
    expect(dag.nodes.get('n1')!.status).toBe('completed');
    expect(dag.nodes.get('n1')!.attempts).toHaveLength(3);
    expect(dag.status).toBe('completed');
  });

  it('skips alternatives when one succeeds', async () => {
    const a1 = makeAction('approach-a', [], ['result']);
    const a2 = makeAction('approach-b', [], ['result']);

    const dag = makeDag(
      [
        makeNode('n1', a1, { outputGroup: 'result', risk: 0.8 }),
        makeNode('n2', a2, { outputGroup: 'result', risk: 0.3 }),
      ],
      [],
    );
    engine.validateAndSeal(dag);

    await engine.executePlan(dag, passThroughExecutor);

    // n1 has higher risk → executes first → succeeds → n2 skipped
    expect(dag.nodes.get('n1')!.status).toBe('completed');
    expect(dag.nodes.get('n2')!.status).toBe('skipped');
    expect(dag.status).toBe('completed');
  });

  it('prioritizes high-risk nodes first', async () => {
    const a1 = makeAction('low-risk', [], ['r1']);
    const a2 = makeAction('high-risk', [], ['r2']);

    const dag = makeDag(
      [
        makeNode('lo', a1, { risk: 0.2, value: 1 }),
        makeNode('hi', a2, { risk: 0.9, value: 1 }),
      ],
      [],
    );
    engine.validateAndSeal(dag);

    const order: string[] = [];
    const orderTracker: ActionExecutor = {
      async execute(node) {
        order.push(node.id);
        return { outputs: {}, validationResults: [] };
      },
    };

    await engine.executePlan(dag, orderTracker);

    // Both are ready simultaneously; high-risk should go first
    expect(order[0]).toBe('hi');
  });

  it('respects external input availability', async () => {
    const a1 = makeAction('act-a', ['ext'], ['data']);
    const n1 = makeNode('n1', a1);

    const dag = makeDag([n1], [], [
      {
        targetNodeId: 'n1',
        targetInput: 'ext',
        description: 'External data',
        available: false, // Not yet available
      },
    ]);
    engine.validateAndSeal(dag);

    // First round: nothing executes (external input unavailable)
    const round1 = await engine.executeRound(dag, passThroughExecutor);
    expect(round1).toHaveLength(0);

    // Make input available
    dag.externalInputs[0].available = true;

    // Second round: n1 executes
    const round2 = await engine.executeRound(dag, passThroughExecutor);
    expect(round2).toHaveLength(1);
    expect(round2[0].id).toBe('n1');
  });

  it('resolves inputs from upstream outputs', async () => {
    const a1 = makeAction('producer', [], ['data']);
    const a2 = makeAction('consumer', ['data'], ['result']);

    const dag = makeDag(
      [makeNode('producer', a1), makeNode('consumer', a2)],
      [makeEdge('producer', 'data', 'consumer', 'data')],
    );
    engine.validateAndSeal(dag);

    let receivedInputs: Record<string, unknown> = {};
    const inputCapture: ActionExecutor = {
      async execute(node, inputs) {
        if (node.id === 'consumer') receivedInputs = inputs;
        const outputs: Record<string, unknown> = {};
        for (const out of node.action?.outputs ?? []) {
          outputs[out.name] = `value-from-${node.id}`;
        }
        return { outputs, validationResults: [] };
      },
    };

    await engine.executePlan(dag, inputCapture);

    expect(receivedInputs['data']).toBe('value-from-producer');
  });

  it('interrupts on risk indicator', async () => {
    const action = makeAction('risky', [], ['data']);
    action.maxAttempts = 5;
    action.riskIndicators = [
      {
        id: 'too-many-attempts',
        description: 'Too many attempts',
        type: 'attempt-count',
        threshold: 2,
        response: 'interrupt',
      },
    ];

    const n1 = makeNode('n1', action);
    const dag = makeDag([n1], []);
    engine.validateAndSeal(dag);

    // Fail twice, then the risk indicator should trigger
    let calls = 0;
    const alwaysFail: ActionExecutor = {
      async execute() {
        calls++;
        return { outputs: {}, validationResults: [], error: 'fail' };
      },
    };

    await engine.executePlan(dag, alwaysFail);

    expect(dag.nodes.get('n1')!.status).toBe('interrupted');
    expect(dag.status).toBe('interrupted');
    // Should have stopped after 2 attempts + interrupt detection
    expect(calls).toBe(2);
  });
});
