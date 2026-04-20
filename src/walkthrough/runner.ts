/**
 * WalkthroughRunner
 *
 * Loads a scenario's corpus into a fresh OpenContext, sets up instrumentation
 * (events, feedback, training data), orchestrates each objective through
 * the meta-plan, and captures the full result for review.
 *
 * Usage:
 *   const runner = new WalkthroughRunner({ embedder });
 *   const result = await runner.run(myScenario);
 *   console.log(formatWalkthroughSummary(result));
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  WalkthroughScenario,
  WalkthroughResult,
  WalkthroughTierResults,
  WalkthroughStats,
  SelfReportedSufficiency,
} from './types.js';
import type {
  AdditionalContext,
  AdditionalUnit,
  WalkthroughAgent,
} from './types.js';
import type { Embedder } from '../storage/embedder.js';
import type { AgentAdapter, AgentTurn } from '../processing/agent-adapter.js';
import { OpenContext } from '../index.js';
import { AnthropicAgentAdapter } from '../processing/anthropic-adapter.js';
import { NoopAgentAdapter } from '../processing/agent-adapter.js';
import {
  ToolRegistry,
  createUserInputTool,
  QueuedUserInputHandler,
} from '../execution/tools.js';
import {
  createGetUnitDetailTool,
  createQueryKnowledgeTool,
} from '../execution/standard-tools.js';
import { VectorRetriever } from '../retrieval/retriever.js';
import {
  AgentActionExecutor,
} from '../execution/agent-executor.js';
import { DAGEngine } from '../execution/dag-engine.js';
import { Orchestrator } from '../execution/orchestrator.js';
import { ExecutionEventEmitter } from '../execution/events.js';
import { InMemoryFeedbackStore } from '../execution/feedback.js';
import { InMemoryTrainingDataStore } from '../retrieval/training-data.js';
import type { ExecutionEvent } from '../execution/events.js';
import type { FeedbackStore } from '../execution/feedback.js';
import type { TrainingDataStore, TrainingExample } from '../retrieval/training-data.js';
import type { PlanDAG, PlanNode } from '../execution/plan-dag.js';
import type { OrchestrationResult } from '../execution/orchestrator.js';

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface WalkthroughRunnerDeps {
  embedder: Embedder;
}

export class WalkthroughRunner {
  constructor(private deps: WalkthroughRunnerDeps) {}

  /**
   * Run a scenario end-to-end and return the captured result.
   * Uses a fresh OpenContext instance for each run.
   */
  async run(scenario: WalkthroughScenario): Promise<WalkthroughResult> {
    const startedAt = Date.now();

    // ── 1. Build a fresh OpenContext ──
    const oc = new OpenContext({ embedder: this.deps.embedder });

    // Contexts are created from the corpus in dependency order (parents first).
    const contextIdMap = new Map<string, string>();
    const allContexts = [
      ...scenario.corpus.contexts,
      ...(scenario.additionalContexts ?? []),
    ];
    for (const bc of topoSortContexts(allContexts)) {
      const parentId = bc.parentId ? contextIdMap.get(bc.parentId) : undefined;
      const ctx = await oc.createContext({
        name: bc.name,
        description: bc.description,
        parentId,
        metadata: {},
      });
      contextIdMap.set(bc.id, ctx.id);
    }

    // Seed corpus units
    for (const bu of scenario.corpus.units) {
      const ctxId = contextIdMap.get(bu.contextId);
      if (!ctxId) continue;
      await oc.acquire(bu.content, ctxId, {
        contentType: bu.contentType,
        tags: [...bu.tags, `corpus-id:${bu.corpusId}`],
        sourceType: 'system',
      });
    }

    // Seed additional units
    for (const au of scenario.additionalUnits ?? []) {
      const ctxId = contextIdMap.get(au.contextId);
      if (!ctxId) continue;
      await oc.acquire(au.content, ctxId, {
        contentType: au.contentType,
        tags: au.tags,
        sourceType: 'system',
      });
    }

    // Seed meta-actions into the first root context (or the first context)
    // unless disabled. Meta-actions are needed for the orchestrator.
    const shouldSeedMetaActions = scenario.seedMetaActions !== false;
    if (shouldSeedMetaActions) {
      const rootCorpus = allContexts.find((c) => !c.parentId);
      const rootId = rootCorpus
        ? contextIdMap.get(rootCorpus.id)
        : [...contextIdMap.values()][0];
      if (rootId) {
        await oc.seedMetaActions(rootId);
      }
    }

    // ── 2. Build observation stack ──
    const emitter = new ExecutionEventEmitter();
    const capturedEvents: ExecutionEvent[] = [];
    emitter.subscribe((e) => {
      capturedEvents.push(e);
    });

    const feedbackStore: FeedbackStore = new InMemoryFeedbackStore();
    const trainingDataStore: TrainingDataStore = new InMemoryTrainingDataStore();

    // ── 3. Build tool registry ──
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
            ? contextIdMap.get(scenario.objectives[0].contextId) ?? scenario.objectives[0].contextId
            : '',
        ),
      );
      toolRegistry.register(createUserInputTool(userInputHandler));
    }

    // ── 4. Build agent adapter ──
    const agentAdapter = buildAgentAdapter(scenario.execution.agent);

    // ── 5. Build executor + DAG engine + orchestrator ──
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
        trainingBridge: scenario.execution.recordTrainingData !== false
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

    // ── 6. Run each objective ──
    const orchestrations: OrchestrationResult[] = [];
    for (const userObjective of scenario.objectives) {
      const runtimeContextId = contextIdMap.get(userObjective.contextId)
        ?? userObjective.contextId;
      const objective = { ...userObjective, contextId: runtimeContextId };
      const result = await orchestrator.orchestrate(objective);
      orchestrations.push(result);
    }

    const completedAt = Date.now();

    // ── 7. Collect final state ──
    const feedbackRecords = await feedbackStore.getAll();
    const trainingExamples = await trainingDataStore.getAll();

    // ── 8. Compute tier results ──
    const tiers = computeTierResults(orchestrations, feedbackRecords, scenario);

    // ── 9. Compute stats ──
    const stats = computeStats(scenario, orchestrations, feedbackRecords);

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
      tiers,
      stats,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers: agent adapter construction
// ---------------------------------------------------------------------------

function buildAgentAdapter(agent: WalkthroughAgent): AgentAdapter {
  switch (agent.type) {
    case 'anthropic':
      return new AnthropicAgentAdapter({
        model: agent.model,
        maxTokens: agent.maxTokens ?? 4096,
        temperature: agent.temperature ?? 0.7,
        apiKey: agent.apiKey,
      });
    case 'noop':
      return new NoopAgentAdapter();
    case 'custom':
      return agent.adapter;
  }
}

// ---------------------------------------------------------------------------
// Helpers: tier + stats computation
// ---------------------------------------------------------------------------

function computeTierResults(
  orchestrations: OrchestrationResult[],
  feedbacks: any[],
  scenario: WalkthroughScenario,
): WalkthroughTierResults {
  // Tier 1: produced output
  const producedOutput = orchestrations.some(
    (o) => collectAllNodes(o).some((n) => hasSuccessfulAttempt(n)),
  );

  // Tier 2: basic validation — all terminal nodes completed, all validations passed
  const basicValidation = orchestrations.every((o) => {
    if (o.status !== 'completed') return false;
    for (const node of collectAllNodes(o)) {
      const last = node.attempts[node.attempts.length - 1];
      if (!last) continue;
      if (last.status !== 'succeeded') return false;
      for (const vr of last.validationResults) {
        if (!vr.passed) return false;
      }
    }
    return true;
  });

  // Tier 3: best self-reported sufficiency
  const selfReportedSufficiency = bestSufficiency(
    feedbacks.map((f) => f.feedback.contextQuality),
  );

  // Passed expectations?
  const expect = scenario.expectations ?? {};
  const expectOutput = expect.expectOutput !== false;
  const expectBasic = expect.expectBasicValidation !== false;
  const minSuff = expect.minSelfReportedSufficiency;

  let passedExpectations = true;
  if (expectOutput && !producedOutput) passedExpectations = false;
  if (expectBasic && !basicValidation) passedExpectations = false;
  if (minSuff) {
    if (
      selfReportedSufficiency == null
      || (minSuff === 'sufficient' && selfReportedSufficiency !== 'sufficient')
      || (minSuff === 'mostly-sufficient'
          && selfReportedSufficiency !== 'sufficient'
          && selfReportedSufficiency !== 'mostly-sufficient')
    ) {
      passedExpectations = false;
    }
  }

  return {
    producedOutput,
    basicValidation,
    selfReportedSufficiency,
    passedExpectations,
  };
}

function bestSufficiency(values: (SelfReportedSufficiency | string | undefined)[]): SelfReportedSufficiency {
  const order: SelfReportedSufficiency[] = [
    'sufficient',
    'mostly-sufficient',
    'insufficient',
    'excessive',
  ];
  let best: SelfReportedSufficiency = null;
  for (const v of values) {
    if (!v) continue;
    const idx = order.indexOf(v as SelfReportedSufficiency);
    if (idx === -1) continue;
    if (best == null || idx < order.indexOf(best)) {
      best = v as SelfReportedSufficiency;
    }
  }
  return best;
}

function computeStats(
  scenario: WalkthroughScenario,
  orchestrations: OrchestrationResult[],
  feedbacks: any[],
): WalkthroughStats {
  let totalActions = 0;
  let totalAttempts = 0;
  let failedAttempts = 0;
  let totalToolCalls = 0;

  for (const o of orchestrations) {
    const nodes = collectAllNodes(o);
    totalActions += nodes.length;
    for (const node of nodes) {
      totalAttempts += node.attempts.length;
      for (const attempt of node.attempts) {
        if (attempt.status === 'failed') failedAttempts++;
        const meta = attempt.executionMeta as any;
        if (meta?.totalToolCalls) totalToolCalls += meta.totalToolCalls;
      }
    }
  }

  // Sum tokens from feedback records (via their metadata, if available)
  // Tokens are recorded in agent output metadata. Walk feedback records' attempts
  // is not direct — tokens live in the attempt executionMeta.
  let totalTokens = 0;
  for (const o of orchestrations) {
    for (const node of collectAllNodes(o)) {
      for (const attempt of node.attempts) {
        const meta = attempt.executionMeta as any;
        const agentMeta = meta?.agentMeta;
        if (agentMeta?.inputTokens) totalTokens += agentMeta.inputTokens;
        if (agentMeta?.outputTokens) totalTokens += agentMeta.outputTokens;
      }
    }
  }

  return {
    totalObjectives: scenario.objectives.length,
    totalActions,
    totalAttempts,
    failedAttempts,
    totalTokens,
    totalToolCalls,
    unitsInCorpus: scenario.corpus.units.length + (scenario.additionalUnits?.length ?? 0),
    contextsInCorpus: scenario.corpus.contexts.length + (scenario.additionalContexts?.length ?? 0),
  };
}

function collectAllNodes(result: OrchestrationResult): PlanNode[] {
  const out: PlanNode[] = [];
  out.push(...result.metaPlan.nodes.values());
  for (const sub of result.subObjectives) {
    out.push(...collectAllNodes(sub));
  }
  return out;
}

function hasSuccessfulAttempt(node: PlanNode): boolean {
  return node.attempts.some((a) => a.status === 'succeeded');
}

// ---------------------------------------------------------------------------
// Helpers: topological sort
// ---------------------------------------------------------------------------

function topoSortContexts(contexts: AdditionalContext[]): AdditionalContext[] {
  const sorted: AdditionalContext[] = [];
  const placed = new Set<string>();
  const remaining = [...contexts];

  while (remaining.length > 0) {
    const beforeCount = remaining.length;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      if (!c.parentId || placed.has(c.parentId)) {
        sorted.push(c);
        placed.add(c.id);
        remaining.splice(i, 1);
        i--;
      }
    }
    if (remaining.length === beforeCount) {
      throw new Error(
        `Cycle or missing parent in context hierarchy. Unplaced: ${remaining.map((r) => r.id).join(', ')}`,
      );
    }
  }

  return sorted;
}
