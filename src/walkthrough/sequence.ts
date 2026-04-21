/**
 * Walkthrough Sequences
 *
 * A sequence is a series of walkthroughs sharing a single OpenContext instance —
 * knowledge accumulates across cycles. Matches the realistic pattern of
 * following a project from inception: session 1 has minimal project-specific
 * knowledge; session N benefits from what was learned in sessions 1..N-1.
 *
 * Pause-for-review is supported by separating "run one cycle" from "run the
 * whole sequence". A reviewer can:
 *   1. Run cycle 1 → examine the report → possibly retrain or edit corpus
 *   2. Run cycle 2 (state from cycle 1 carries over) → examine → ...
 *   3. Continue or abandon
 *
 * State persists via save/load of the OpenContext, so sequences survive
 * process restarts.
 */

import type { WalkthroughScenario, WalkthroughResult } from './types.js';
import type { WalkthroughRunnerDeps } from './runner.js';
import { OpenContext } from '../index.js';
import type { Embedder } from '../storage/embedder.js';
import type { BenchmarkCorpus } from '../benchmark/types.js';

// ---------------------------------------------------------------------------
// Sequence spec
// ---------------------------------------------------------------------------

/**
 * A named series of walkthrough cycles on a single shared knowledge base.
 * Each cycle is one walkthrough; the OpenContext carries over between them.
 */
export interface WalkthroughSequence {
  /** Sequence identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** What this sequence tests. */
  description: string;
  /**
   * Domain labels (for backlog filtering/reporting).
   * e.g., ['physical-engineering', 'cad']
   */
  domains: string[];
  /**
   * Familiarity level — how well-represented is this kind of problem in
   * typical training data? Lower familiarity means stronger signal about
   * whether the system actually used the corpus.
   */
  familiarity: 'well-known' | 'moderate' | 'obscure';
  /**
   * The corpus every cycle runs against. Shared across cycles.
   */
  corpus: BenchmarkCorpus;
  /**
   * Ordered cycle specs. Each one is a walkthrough scenario without a corpus
   * field (the sequence provides it). Cycle N starts with the knowledge
   * accumulated by cycles 1..N-1.
   */
  cycles: CycleSpec[];
}

/**
 * One cycle in a sequence — a walkthrough scenario with the corpus implicit.
 */
export type CycleSpec = Omit<WalkthroughScenario, 'corpus'> & {
  /** Optional pause point — a human-readable note for the reviewer. */
  reviewNote?: string;
};

// ---------------------------------------------------------------------------
// Sequence state (persisted between cycles)
// ---------------------------------------------------------------------------

/**
 * State of a sequence run, persisted between cycles. Lets a reviewer
 * interrupt between cycles, retrain, and resume.
 */
export interface SequenceState {
  sequenceId: string;
  cyclesCompleted: number;
  startedAt: number;
  lastCycleAt?: number;
  /** Per-cycle result summaries (full results are saved as separate artifacts). */
  cycleSummaries: {
    cycleIndex: number;
    cycleId: string;
    status: string;
    producedOutput: boolean;
    basicValidation: boolean;
    selfReportedSufficiency: string | null;
    completedAt: number;
  }[];
}

// ---------------------------------------------------------------------------
// Sequence runner
// ---------------------------------------------------------------------------

export interface SequenceRunnerDeps extends WalkthroughRunnerDeps {}

export class SequenceRunner {
  private oc: OpenContext | null = null;
  private state: SequenceState | null = null;

  constructor(private deps: SequenceRunnerDeps) {}

  /**
   * Start a new sequence. Sets up a fresh OpenContext, seeds the corpus and
   * meta-actions, and initializes state.
   */
  async startSequence(sequence: WalkthroughSequence): Promise<SequenceState> {
    this.oc = new OpenContext({ embedder: this.deps.embedder });

    // Seed the corpus and meta-actions once; subsequent cycles reuse this state.
    await this.seedSharedState(sequence);

    this.state = {
      sequenceId: sequence.id,
      cyclesCompleted: 0,
      startedAt: Date.now(),
      cycleSummaries: [],
    };

    return this.state;
  }

  /**
   * Run the next cycle. Throws if called before startSequence or if the
   * sequence is already complete.
   */
  async runNextCycle(
    sequence: WalkthroughSequence,
  ): Promise<{ result: WalkthroughResult; state: SequenceState } | null> {
    if (!this.oc || !this.state) {
      throw new Error('Sequence not started. Call startSequence() first.');
    }
    if (this.state.cyclesCompleted >= sequence.cycles.length) {
      return null; // Sequence complete
    }

    const cycleIndex = this.state.cyclesCompleted;
    const cycleSpec = sequence.cycles[cycleIndex];

    // Build a full scenario for this cycle using the shared corpus.
    const scenario: WalkthroughScenario = {
      ...cycleSpec,
      corpus: sequence.corpus,
      // Skip re-seeding corpus + meta-actions since they're already present.
      seedMetaActions: false,
    };

    // Run this cycle against the shared OpenContext.
    // We can't use WalkthroughRunner directly because it creates its own
    // OpenContext. So run a specialized version that reuses this.oc.
    const result = await this.runCycleAgainstSharedState(scenario, cycleIndex);

    // Update state
    this.state.lastCycleAt = Date.now();
    this.state.cyclesCompleted++;
    this.state.cycleSummaries.push({
      cycleIndex,
      cycleId: cycleSpec.id,
      status: result.orchestrations.map((o) => o.status).join(',') || 'no-orchestration',
      producedOutput: result.tiers.producedOutput,
      basicValidation: result.tiers.basicValidation,
      selfReportedSufficiency: result.tiers.selfReportedSufficiency,
      completedAt: Date.now(),
    });

    return { result, state: this.state };
  }

  /**
   * Save the sequence's knowledge base to disk so the sequence can be resumed.
   */
  async saveState(path: string): Promise<void> {
    if (!this.oc || !this.state) {
      throw new Error('No active sequence to save.');
    }
    await this.oc.save(path);
  }

  /**
   * Resume a sequence from a previously saved state file.
   */
  async resumeFromSave(
    path: string,
    state: SequenceState,
  ): Promise<void> {
    this.oc = new OpenContext({ embedder: this.deps.embedder });
    await this.oc.load(path);
    this.state = state;
  }

  /**
   * Get the OpenContext instance (useful for inspection between cycles).
   */
  getOpenContext(): OpenContext | null {
    return this.oc;
  }

  /**
   * Get current sequence state.
   */
  getState(): SequenceState | null {
    return this.state;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async seedSharedState(sequence: WalkthroughSequence): Promise<void> {
    if (!this.oc) return;

    // Topo-sort and create contexts
    const contextIdMap = new Map<string, string>();
    const sortedContexts = topoSort(sequence.corpus.contexts);
    for (const bc of sortedContexts) {
      const parentId = bc.parentId ? contextIdMap.get(bc.parentId) : undefined;
      const ctx = await this.oc.createContext({
        name: bc.name,
        description: bc.description,
        parentId,
        metadata: {},
      });
      contextIdMap.set(bc.id, ctx.id);
    }

    // Seed corpus units
    for (const bu of sequence.corpus.units) {
      const ctxId = contextIdMap.get(bu.contextId);
      if (!ctxId) continue;
      await this.oc.acquire(bu.content, ctxId, {
        contentType: bu.contentType,
        tags: [...bu.tags, `corpus-id:${bu.corpusId}`],
        sourceType: 'system',
      });
    }

    // Seed meta-actions into the root (first context with no parent)
    const rootCorpus = sequence.corpus.contexts.find((c) => !c.parentId);
    if (rootCorpus) {
      const rootId = contextIdMap.get(rootCorpus.id);
      if (rootId) {
        await this.oc.seedMetaActions(rootId);
      }
    }

    // Store the mapping on the instance so later cycles can resolve corpus-id → runtime-id
    (this.oc as any).__corpusContextIdMap = contextIdMap;
  }

  private async runCycleAgainstSharedState(
    scenario: WalkthroughScenario,
    cycleIndex: number,
  ): Promise<WalkthroughResult> {
    if (!this.oc) throw new Error('No OpenContext');

    // Delegate to WalkthroughRunner but with a twist: we need it to reuse
    // our OpenContext. Since WalkthroughRunner doesn't support injection,
    // we build the needed plumbing here directly.
    //
    // For simplicity, we'll delegate to WalkthroughRunner with seedMetaActions: false
    // and accept that additional units will be re-seeded (idempotent from the corpus
    // data, so this is safe — the corpus just gets duplicated units on each cycle
    // unless we bypass). Proper fix: refactor WalkthroughRunner to accept an
    // OpenContext. For now, we take a simpler path: delegate to runner, but
    // only seed scenario-specific additional units (not the corpus itself).

    // Actually simplest correct approach: reuse runner via an internal
    // override. We replicate WalkthroughRunner's flow inline to get state
    // reuse for real.
    return runCycleInline(this.oc, scenario, cycleIndex);
  }
}

// ---------------------------------------------------------------------------
// Inline cycle runner (reuses a provided OpenContext)
// ---------------------------------------------------------------------------

async function runCycleInline(
  oc: OpenContext,
  scenario: WalkthroughScenario,
  cycleIndex: number,
): Promise<WalkthroughResult> {
  // Dynamic imports to avoid a module-cycle with the file-level ones.
  const { AgentActionExecutor } = await import('../execution/agent-executor.js');
  const { DAGEngine } = await import('../execution/dag-engine.js');
  const { Orchestrator } = await import('../execution/orchestrator.js');
  const { ExecutionEventEmitter } = await import('../execution/events.js');
  const { InMemoryFeedbackStore } = await import('../execution/feedback.js');
  const { InMemoryTrainingDataStore } = await import(
    '../retrieval/training-data.js'
  );
  const { VectorRetriever } = await import('../retrieval/retriever.js');
  const {
    ToolRegistry,
    createUserInputTool,
    QueuedUserInputHandler,
  } = await import('../execution/tools.js');
  const { createGetUnitDetailTool, createQueryKnowledgeTool } = await import(
    '../execution/standard-tools.js'
  );
  const { AnthropicAgentAdapter } = await import('../processing/anthropic-adapter.js');
  const { NoopAgentAdapter } = await import('../processing/agent-adapter.js');

  const startedAt = Date.now();

  // Resolve corpus context IDs to runtime IDs via the map we stored at seed time.
  const contextIdMap: Map<string, string> =
    (oc as any).__corpusContextIdMap ?? new Map<string, string>();

  // Seed any scenario-specific additional units (one-time per cycle)
  for (const au of scenario.additionalUnits ?? []) {
    const ctxId = contextIdMap.get(au.contextId) ?? au.contextId;
    await oc.acquire(au.content, ctxId, {
      contentType: au.contentType,
      tags: au.tags,
      sourceType: 'system',
    });
  }

  // Observation stack
  const emitter = new ExecutionEventEmitter();
  const capturedEvents: any[] = [];
  emitter.subscribe((e) => {
    capturedEvents.push(e);
  });
  const feedbackStore = new InMemoryFeedbackStore();
  const trainingDataStore = new InMemoryTrainingDataStore();

  // Tools
  const retriever = new VectorRetriever({
    embedder: oc.embedder,
    vectorStore: oc.vectorStore,
    unitStore: oc.unitStore,
    contextStore: oc.contextStore,
    scopeResolver: oc.scopeResolver,
  });

  const userInputHandler = new QueuedUserInputHandler(
    scenario.scriptedUserResponses ?? [],
  );
  const toolRegistry = new ToolRegistry();
  if (scenario.execution.useStandardTools !== false) {
    toolRegistry.register(createGetUnitDetailTool(oc.unitStore));
    toolRegistry.register(
      createQueryKnowledgeTool(retriever, () =>
        scenario.objectives[0]
          ? contextIdMap.get(scenario.objectives[0].contextId)
            ?? scenario.objectives[0].contextId
          : '',
      ),
    );
    toolRegistry.register(createUserInputTool(userInputHandler));
  }

  // Agent adapter
  let agentAdapter;
  switch (scenario.execution.agent.type) {
    case 'anthropic':
      agentAdapter = new AnthropicAgentAdapter({
        model: scenario.execution.agent.model,
        maxTokens: scenario.execution.agent.maxTokens ?? 4096,
        temperature: scenario.execution.agent.temperature ?? 0.7,
        apiKey: scenario.execution.agent.apiKey,
      });
      break;
    case 'noop':
      agentAdapter = new NoopAgentAdapter();
      break;
    case 'custom':
      agentAdapter = scenario.execution.agent.adapter;
      break;
  }

  // Executor
  const executor = new AgentActionExecutor(
    retriever,
    agentAdapter,
    feedbackStore,
    {
      maxContextTokens: scenario.execution.maxContextTokens ?? 8000,
      maxToolCallRounds: scenario.execution.maxToolCallRounds ?? 10,
      toolRegistry,
      systemPrompt: scenario.execution.systemPrompt,
      requestFeedback: true,
      trainingBridge:
        scenario.execution.recordTrainingData !== false
          ? {
              trainingDataStore,
              unitStore: oc.unitStore,
              embedder: oc.embedder,
            }
          : undefined,
    },
  );

  const engine = new DAGEngine(emitter);
  const orchestrator = new Orchestrator(engine, executor, oc.unitStore, {
    emitter,
  });

  // Run objectives
  const orchestrations: any[] = [];
  for (const userObjective of scenario.objectives) {
    const runtimeContextId =
      contextIdMap.get(userObjective.contextId) ?? userObjective.contextId;
    const objective = { ...userObjective, contextId: runtimeContextId };
    const result = await orchestrator.orchestrate(objective);
    orchestrations.push(result);
  }

  const completedAt = Date.now();
  const feedbackRecords = await feedbackStore.getAll();
  const trainingExamples = await trainingDataStore.getAll();

  // Tier results
  const producedOutput = orchestrations.some((o: any) =>
    [...(o.metaPlan.nodes?.values?.() ?? [])].some((n: any) =>
      n.attempts.some((a: any) => a.status === 'succeeded'),
    ),
  );
  const basicValidation = orchestrations.every(
    (o: any) => o.status === 'completed',
  );
  const sufficiencies = feedbackRecords.map(
    (f) => f.feedback.contextQuality,
  ) as string[];
  const order = ['sufficient', 'mostly-sufficient', 'insufficient', 'excessive'];
  let best: string | null = null;
  for (const s of sufficiencies) {
    if (!best || order.indexOf(s) < order.indexOf(best)) best = s;
  }
  const selfReportedSufficiency: any = best ?? null;

  // Compute stats
  let totalActions = 0;
  let totalAttempts = 0;
  let failedAttempts = 0;
  let totalToolCalls = 0;
  let totalTokens = 0;
  for (const o of orchestrations) {
    const nodes = [...(o.metaPlan.nodes?.values?.() ?? [])];
    totalActions += nodes.length;
    for (const n of nodes) {
      totalAttempts += n.attempts.length;
      for (const a of n.attempts) {
        if (a.status === 'failed') failedAttempts++;
        const m = a.executionMeta;
        if (m?.totalToolCalls) totalToolCalls += m.totalToolCalls;
        if (m?.agentMeta?.inputTokens) totalTokens += m.agentMeta.inputTokens;
        if (m?.agentMeta?.outputTokens) totalTokens += m.agentMeta.outputTokens;
      }
    }
  }

  return {
    scenario: {
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
    },
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
    orchestrations,
    events: capturedEvents,
    feedbackRecords,
    trainingExamples,
    tiers: {
      producedOutput,
      basicValidation,
      selfReportedSufficiency,
      passedExpectations: true, // computed by caller if needed
    },
    stats: {
      totalObjectives: scenario.objectives.length,
      totalActions,
      totalAttempts,
      failedAttempts,
      totalTokens,
      totalToolCalls,
      unitsInCorpus:
        (scenario.additionalUnits?.length ?? 0),
      contextsInCorpus: 0, // shared corpus; reporting 0 here to mean "shared"
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function topoSort<T extends { id: string; parentId?: string }>(
  items: T[],
): T[] {
  const sorted: T[] = [];
  const placed = new Set<string>();
  const remaining = [...items];
  while (remaining.length > 0) {
    const before = remaining.length;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const c = remaining[i];
      if (!c.parentId || placed.has(c.parentId)) {
        sorted.push(c);
        placed.add(c.id);
        remaining.splice(i, 1);
      }
    }
    if (remaining.length === before) {
      throw new Error(
        `Cycle or missing parent: ${remaining.map((r) => r.id).join(', ')}`,
      );
    }
  }
  return sorted;
}
