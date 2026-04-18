import { describe, it, expect } from 'vitest';
import {
  OpenContext,
  DeterministicEmbedder,
  Orchestrator,
  DAGEngine,
  ExecutionEventEmitter,
  filterEvents,
  formatOrchestrationTrace,
  createLiveEventLogger,
  META_ACTION_IDS,
} from '../src/index.js';
import type {
  Objective,
  PlanNode,
  ValidationResult,
  ActionExecutor,
  ExecutionEvent,
} from '../src/index.js';

// ── Mock executor (same as orchestrator tests) ───────────────────────────

function makeMockExecutor(): ActionExecutor {
  return {
    async execute(node, inputs) {
      const action = node.action!;
      const outputs: Record<string, unknown> = {};
      const validationResults: ValidationResult[] = [];

      switch (action.id) {
        case META_ACTION_IDS.CLASSIFY:
          outputs['classification'] = { matches: [], gaps: [], overallConfidence: 0.8 };
          outputs['__objectiveDescription'] = inputs['objectiveDescription'];
          break;
        case META_ACTION_IDS.CLARIFY:
          outputs['clarifiedObjective'] = {
            description: `Clarified: ${inputs['objectiveDescription']}`,
            domainReferences: [],
            acceptanceCriteria: ['Done'],
          };
          outputs['isFullyClarified'] = true;
          break;
        case META_ACTION_IDS.SEARCH:
          outputs['searchResult'] = { candidates: [], coverageAssessment: 'complete' };
          break;
        case META_ACTION_IDS.SELECT:
          outputs['selection'] = { decision: 'select-one', rationale: 'ok' };
          break;
        case META_ACTION_IDS.EXECUTE:
          outputs['executionResult'] = { outcomes: [] };
          break;
        case META_ACTION_IDS.INCORPORATE:
          outputs['incorporation'] = { updates: {}, objectiveStatus: 'completed' };
          break;
      }
      return { outputs, validationResults };
    },
  };
}

// ── ExecutionEventEmitter tests ─────────────────────────────────────────

describe('ExecutionEventEmitter', () => {
  it('emits events to all subscribers', () => {
    const emitter = new ExecutionEventEmitter();
    const events1: ExecutionEvent[] = [];
    const events2: ExecutionEvent[] = [];

    emitter.subscribe((e) => events1.push(e));
    emitter.subscribe((e) => events2.push(e));

    emitter.emit({
      type: 'orchestration.started',
      objective: {
        id: 'o1',
        name: 'Test',
        description: 'Test',
        contextId: 'c',
        acceptanceCriteria: [],
        isLearningObjective: false,
        priority: 1,
        status: 'defined',
      },
      depth: 0,
    });

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    expect(events1[0].type).toBe('orchestration.started');
    expect(events1[0].timestamp).toBeGreaterThan(0);
    expect(events1[0].seq).toBe(1);
  });

  it('unsubscribe works', () => {
    const emitter = new ExecutionEventEmitter();
    const events: ExecutionEvent[] = [];
    const unsub = emitter.subscribe((e) => events.push(e));

    emitter.emit({
      type: 'plan.started',
      planId: 'p1',
      objectiveId: 'o1',
      nodeCount: 6,
    });
    expect(events).toHaveLength(1);

    unsub();
    emitter.emit({
      type: 'plan.completed',
      planId: 'p1',
      status: 'completed',
      durationMs: 100,
    });
    expect(events).toHaveLength(1); // still 1
  });

  it('assigns monotonically increasing sequence numbers', () => {
    const emitter = new ExecutionEventEmitter();
    const events: ExecutionEvent[] = [];
    emitter.subscribe((e) => events.push(e));

    for (let i = 0; i < 5; i++) {
      emitter.emit({
        type: 'plan.started',
        planId: `p${i}`,
        objectiveId: 'o1',
        nodeCount: 1,
      });
    }

    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('handler errors do not stop other handlers', () => {
    const emitter = new ExecutionEventEmitter();
    const events: ExecutionEvent[] = [];

    emitter.subscribe(() => { throw new Error('handler 1 error'); });
    emitter.subscribe((e) => events.push(e));

    // Suppress console.error for this test
    const origError = console.error;
    console.error = () => {};
    try {
      emitter.emit({
        type: 'plan.started',
        planId: 'p1',
        objectiveId: 'o1',
        nodeCount: 1,
      });
    } finally {
      console.error = origError;
    }

    expect(events).toHaveLength(1);
  });

  it('filterEvents creates type-filtered handler', () => {
    const emitter = new ExecutionEventEmitter();
    const nodeEvents: ExecutionEvent[] = [];

    emitter.subscribe(filterEvents(['node.started', 'node.completed'], (e) => nodeEvents.push(e)));

    emitter.emit({ type: 'plan.started', planId: 'p', objectiveId: 'o', nodeCount: 1 });
    emitter.emit({
      type: 'node.started',
      planId: 'p',
      nodeId: 'n',
      actionId: 'a',
      actionName: 'A',
      attemptNumber: 1,
    });
    emitter.emit({ type: 'plan.completed', planId: 'p', status: 'completed', durationMs: 0 });

    expect(nodeEvents).toHaveLength(1);
    expect(nodeEvents[0].type).toBe('node.started');
  });
});

// ── Event emission during orchestration ─────────────────────────────────

describe('Orchestration events', () => {
  it('emits expected event sequence during orchestration', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    await oc.seedMetaActions(root.id);

    const emitter = new ExecutionEventEmitter();
    const events: ExecutionEvent[] = [];
    emitter.subscribe((e) => events.push(e));

    const engine = new DAGEngine(emitter);
    const orchestrator = new Orchestrator(engine, makeMockExecutor(), oc.unitStore, { emitter });

    const objective: Objective = {
      id: 'events-1',
      name: 'Test events',
      description: 'Verify events are emitted',
      contextId: root.id,
      acceptanceCriteria: [],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    };

    await orchestrator.orchestrate(objective);

    const eventTypes = events.map((e) => e.type);

    // Should see the expected lifecycle events
    expect(eventTypes[0]).toBe('orchestration.started');
    expect(eventTypes).toContain('plan.started');
    expect(eventTypes).toContain('node.started');
    expect(eventTypes).toContain('node.completed');
    expect(eventTypes).toContain('plan.completed');
    expect(eventTypes[eventTypes.length - 1]).toBe('orchestration.completed');

    // Should have 6 node.started and 6 node.completed for the 6 meta-actions
    const nodeStarted = events.filter((e) => e.type === 'node.started');
    const nodeCompleted = events.filter((e) => e.type === 'node.completed');
    expect(nodeStarted).toHaveLength(6);
    expect(nodeCompleted).toHaveLength(6);
  });

  it('emits orchestration.completed with correct status on cycle detection', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    // Don't seed meta-actions — this will fail the build step

    const emitter = new ExecutionEventEmitter();
    const events: ExecutionEvent[] = [];
    emitter.subscribe((e) => events.push(e));

    const engine = new DAGEngine(emitter);
    const orchestrator = new Orchestrator(engine, makeMockExecutor(), oc.unitStore, { emitter });

    const objective: Objective = {
      id: 'fail-1',
      name: 'Will fail',
      description: 'Meta actions missing',
      contextId: root.id,
      acceptanceCriteria: [],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    };

    await orchestrator.orchestrate(objective);

    const completed = events.find((e) => e.type === 'orchestration.completed');
    expect(completed).toBeDefined();
    expect((completed as any).status).toBe('failed');
  });
});

// ── Trace formatter tests ───────────────────────────────────────────────

describe('formatOrchestrationTrace', () => {
  it('produces human-readable trace for successful orchestration', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    await oc.seedMetaActions(root.id);

    const engine = new DAGEngine();
    const orchestrator = new Orchestrator(engine, makeMockExecutor(), oc.unitStore);

    const objective: Objective = {
      id: 'trace-1',
      name: 'Trace test',
      description: 'Test trace formatting',
      contextId: root.id,
      acceptanceCriteria: ['It works'],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    };

    const result = await orchestrator.orchestrate(objective);
    const trace = formatOrchestrationTrace(result, { color: false });

    // Core elements should appear
    expect(trace).toContain('OBJECTIVE:');
    expect(trace).toContain('Trace test');
    expect(trace).toContain('COMPLETED');
    expect(trace).toContain('META-PLAN');
    expect(trace).toContain('Classify Objective');
    expect(trace).toContain('Clarify Objective');
    expect(trace).toContain('Search Actions');
    expect(trace).toContain('Select Actions');
    expect(trace).toContain('Execute Actions');
    expect(trace).toContain('Incorporate Results');
    expect(trace).toContain('It works'); // acceptance criteria
  });

  it('shows failure information for failed orchestration', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    // Don't seed meta-actions

    const engine = new DAGEngine();
    const orchestrator = new Orchestrator(engine, makeMockExecutor(), oc.unitStore);

    const result = await orchestrator.orchestrate({
      id: 'fail-trace',
      name: 'Fail',
      description: 'Will fail',
      contextId: root.id,
      acceptanceCriteria: [],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    });

    const trace = formatOrchestrationTrace(result, { color: false });
    expect(trace).toContain('FAILED');
    expect(trace).toContain('reason:');
    expect(trace).toContain('meta:classify-objective');
  });

  it('supports color toggling', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    await oc.seedMetaActions(root.id);

    const engine = new DAGEngine();
    const orchestrator = new Orchestrator(engine, makeMockExecutor(), oc.unitStore);

    const result = await orchestrator.orchestrate({
      id: 'color-test',
      name: 'Color',
      description: 'Test',
      contextId: root.id,
      acceptanceCriteria: [],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    });

    const colored = formatOrchestrationTrace(result, { color: true });
    const plain = formatOrchestrationTrace(result, { color: false });

    expect(colored.length).toBeGreaterThan(plain.length);
    expect(colored).toContain('\x1b['); // ANSI escape
    expect(plain).not.toContain('\x1b[');
  });
});

// ── Live event logger ───────────────────────────────────────────────────

describe('createLiveEventLogger', () => {
  it('formats events as single-line log entries', () => {
    const lines: string[] = [];
    const logger = createLiveEventLogger({
      out: (line) => lines.push(line),
      color: false,
    });

    const emitter = new ExecutionEventEmitter();
    emitter.subscribe(logger);

    emitter.emit({
      type: 'orchestration.started',
      objective: {
        id: 'o1',
        name: 'Test',
        description: 'Test',
        contextId: 'c',
        acceptanceCriteria: [],
        isLearningObjective: false,
        priority: 1,
        status: 'defined',
      },
      depth: 0,
    });

    emitter.emit({
      type: 'node.started',
      planId: 'p',
      nodeId: 'n',
      actionId: 'a',
      actionName: 'An Action',
      attemptNumber: 1,
    });

    emitter.emit({
      type: 'node.completed',
      planId: 'p',
      nodeId: 'n',
      actionId: 'a',
      durationMs: 123,
      outputKeys: ['response'],
      validationsPassed: 1,
      validationsFailed: 0,
    });

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('ORCHESTRATE');
    expect(lines[0]).toContain('Test');
    expect(lines[1]).toContain('An Action');
    expect(lines[2]).toContain('a');
    expect(lines[2]).toContain('123ms');
  });

  it('indents by depth when indentByDepth is true', () => {
    const lines: string[] = [];
    const logger = createLiveEventLogger({
      out: (line) => lines.push(line),
      color: false,
      indentByDepth: true,
    });

    const emitter = new ExecutionEventEmitter();
    emitter.subscribe(logger);

    emitter.emit({
      type: 'orchestration.started',
      objective: {
        id: 'top',
        name: 'Top',
        description: 'Top level',
        contextId: 'c',
        acceptanceCriteria: [],
        isLearningObjective: false,
        priority: 1,
        status: 'defined',
      },
      depth: 0,
    });

    emitter.emit({
      type: 'orchestration.started',
      objective: {
        id: 'sub',
        name: 'Sub',
        description: 'Sub level',
        contextId: 'c',
        acceptanceCriteria: [],
        isLearningObjective: false,
        priority: 1,
        status: 'defined',
      },
      depth: 2,
    });

    // Sub-level should have more indent than top-level
    const topIndent = lines[0].length - lines[0].trimStart().length;
    const subIndent = lines[1].length - lines[1].trimStart().length;
    // Can't compare directly due to timestamp prefix, but we can count 'ORCHESTRATE' position
    expect(lines[1].indexOf('ORCHESTRATE')).toBeGreaterThan(
      lines[0].indexOf('ORCHESTRATE'),
    );
  });
});
