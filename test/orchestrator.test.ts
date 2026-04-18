import { describe, it, expect } from 'vitest';
import {
  OpenContext,
  DeterministicEmbedder,
  Orchestrator,
  DAGEngine,
  RecursionGuard,
  META_ACTION_IDS,
  findActionDefinitionById,
} from '../src/index.js';
import type {
  Objective,
  PlanNode,
  ValidationResult,
  ActionExecutor,
} from '../src/index.js';

// ── Mock executor that simulates meta-action outputs ──────────────────────

/**
 * Produces plausible structured outputs for each meta-action based on its
 * action ID. Lets us verify the orchestrator wiring without a real LLM.
 */
function makeMockExecutor(options?: {
  failAction?: string;
  subObjectives?: Objective[];
  subObjectivesOnlyForObjectiveIds?: string[];
  onExecute?: (node: PlanNode) => void;
}): ActionExecutor {
  return {
    async execute(node, inputs) {
      options?.onExecute?.(node);

      if (options?.failAction === node.action?.id) {
        return {
          outputs: {},
          validationResults: [{ validationId: 'v', passed: false, detail: 'simulated failure' }],
          error: 'simulated failure',
        };
      }

      const action = node.action!;
      const outputs: Record<string, unknown> = {};
      const validationResults: ValidationResult[] = [];

      switch (action.id) {
        case META_ACTION_IDS.CLASSIFY:
          outputs['classification'] = {
            matches: [
              { id: 'User', kind: 'resource-type', relevance: 0.9, rationale: 'Core entity' },
            ],
            gaps: [],
            overallConfidence: 0.85,
          };
          // First meta-action also passes through the original objective for clarify
          outputs['__objectiveDescription'] = inputs['objectiveDescription'];
          break;

        case META_ACTION_IDS.CLARIFY:
          outputs['clarifiedObjective'] = {
            description: `Clarified: ${inputs['objectiveDescription']}`,
            domainReferences: [{ id: 'User', role: 'primary' }],
            acceptanceCriteria: ['Output is produced'],
          };
          outputs['isFullyClarified'] = true;
          break;

        case META_ACTION_IDS.SEARCH:
          outputs['searchResult'] = {
            candidates: [
              { actionId: 'domain:build-feature', relevance: 0.8, rationale: 'Good fit' },
            ],
            coverageAssessment: 'complete',
          };
          break;

        case META_ACTION_IDS.SELECT:
          outputs['selection'] = {
            decision: 'select-one',
            selectedActionIds: ['domain:build-feature'],
            executionMode: 'sequential',
            rationale: 'Best fit candidate',
          };
          break;

        case META_ACTION_IDS.EXECUTE: {
          outputs['executionResult'] = {
            outcomes: [
              { actionId: 'domain:build-feature', status: 'succeeded', outputs: { artifact: 'done' } },
            ],
          };
          // Surface sub-objectives only for specific parents (prevents infinite recursion in tests)
          // node.id is structured as `${objectiveId}:meta-execute-actions`
          const parentObjectiveId = node.id.split(':')[0];
          const shouldProduceSubs =
            options?.subObjectives &&
            options.subObjectives.length > 0 &&
            (!options.subObjectivesOnlyForObjectiveIds ||
              options.subObjectivesOnlyForObjectiveIds.includes(parentObjectiveId));
          if (shouldProduceSubs) {
            outputs['__subObjectives'] = options!.subObjectives;
          }
          break;
        }

        case META_ACTION_IDS.INCORPORATE:
          outputs['incorporation'] = {
            updates: {
              domainChanges: [],
              planUpdates: [{ kind: 'mark-complete', description: 'All nodes done' }],
              learnings: [{ observation: 'Flow completed cleanly', category: 'process-improvement' }],
            },
            objectiveStatus: 'completed',
          };
          break;

        default:
          outputs['response'] = 'generic action output';
      }

      return { outputs, validationResults };
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Orchestrator', () => {
  it('executes the full 6-step meta-plan for an objective', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root project' });

    // Seed meta-actions into the root context
    const metaUnits = await oc.seedMetaActions(root.id);
    expect(metaUnits.length).toBeGreaterThanOrEqual(6);

    // Verify meta-actions are findable
    const classify = await findActionDefinitionById(META_ACTION_IDS.CLASSIFY, oc.unitStore);
    expect(classify).not.toBeNull();
    expect(classify!.name).toBe('Classify Objective');

    const engine = new DAGEngine();
    const executedNodes: string[] = [];
    const executor = makeMockExecutor({
      onExecute: (node) => executedNodes.push(node.action!.id),
    });

    const orchestrator = new Orchestrator(engine, executor, oc.unitStore);

    const objective: Objective = {
      id: 'obj-1',
      name: 'Build feature X',
      description: 'Deliver a new feature for the users',
      contextId: root.id,
      acceptanceCriteria: ['Feature works'],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    };

    const result = await orchestrator.orchestrate(objective);

    expect(result.status).toBe('completed');
    expect(result.totalNodesExecuted).toBe(6);
    expect(executedNodes).toEqual([
      META_ACTION_IDS.CLASSIFY,
      META_ACTION_IDS.CLARIFY,
      META_ACTION_IDS.SEARCH,
      META_ACTION_IDS.SELECT,
      META_ACTION_IDS.EXECUTE,
      META_ACTION_IDS.INCORPORATE,
    ]);
    expect(result.metaPlan.status).toBe('completed');
  });

  it('recursively orchestrates sub-objectives', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    await oc.seedMetaActions(root.id);

    const subObjective: Objective = {
      id: 'sub-1',
      name: 'A sub-task',
      description: 'Research renewable energy storage options for residential customers',
      contextId: root.id,
      acceptanceCriteria: ['Completed'],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    };

    const engine = new DAGEngine();
    const executor = makeMockExecutor({
      subObjectives: [subObjective],
      // Only the top-level objective's execute step produces the sub-objective
      subObjectivesOnlyForObjectiveIds: ['top-1'],
    });

    const orchestrator = new Orchestrator(engine, executor, oc.unitStore);

    const topObjective: Objective = {
      id: 'top-1',
      name: 'Top objective',
      description: 'Deliver quarterly financial reporting dashboard for executives',
      contextId: root.id,
      acceptanceCriteria: ['Done'],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    };

    const result = await orchestrator.orchestrate(topObjective);

    expect(result.status).toBe('completed');
    expect(result.subObjectives).toHaveLength(1);
    expect(result.subObjectives[0].objective.id).toBe('sub-1');
    expect(result.subObjectives[0].status).toBe('completed');
    // Both meta-plans ran = 12 nodes
    expect(result.totalNodesExecuted).toBe(12);
  });

  it('detects cycles via recursion guard', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    await oc.seedMetaActions(root.id);

    // The execute step produces a sub-objective that duplicates the parent
    const cyclicSubObjective: Objective = {
      id: 'cycle-1',
      name: 'Cyclic',
      description: 'Build the main software engineering deliverable using TypeScript',
      contextId: root.id,
      acceptanceCriteria: ['Done'],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    };

    const engine = new DAGEngine();
    const executor = makeMockExecutor({ subObjectives: [cyclicSubObjective] });

    const orchestrator = new Orchestrator(
      engine,
      executor,
      oc.unitStore,
      { recursionGuard: new RecursionGuard({ cycleSimilarityThreshold: 0.5 }) },
    );

    const topObjective: Objective = {
      id: 'top-2',
      name: 'Top',
      description: 'Build the main software engineering deliverable using TypeScript',
      contextId: root.id,
      acceptanceCriteria: ['Done'],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    };

    const result = await orchestrator.orchestrate(topObjective);

    // Top-level should succeed but the cyclic sub-objective should be flagged
    expect(result.subObjectives).toHaveLength(1);
    expect(result.subObjectives[0].status).toBe('cycle-detected');
  });

  it('respects maximum recursion depth', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    await oc.seedMetaActions(root.id);

    // Each execution produces a new distinct sub-objective with unique description
    let subCounter = 0;
    const engine = new DAGEngine();

    const descriptions = [
      'Build e-commerce platform for global retailers with multi-currency support',
      'Implement payment gateway integration using Stripe for international transactions',
      'Configure production database with connection pooling and read replicas',
      'Monitor application performance using distributed tracing infrastructure',
    ];

    const executor: ActionExecutor = {
      async execute(node, inputs) {
        const action = node.action!;
        const outputs: Record<string, unknown> = {};

        if (action.id === META_ACTION_IDS.CLASSIFY) {
          outputs['classification'] = { matches: [], gaps: [], overallConfidence: 0.5 };
          outputs['__objectiveDescription'] = inputs['objectiveDescription'];
        } else if (action.id === META_ACTION_IDS.CLARIFY) {
          outputs['clarifiedObjective'] = {
            description: `Clarified: ${inputs['objectiveDescription']}`,
            domainReferences: [],
            acceptanceCriteria: ['Done'],
          };
          outputs['isFullyClarified'] = true;
        } else if (action.id === META_ACTION_IDS.SEARCH) {
          outputs['searchResult'] = { candidates: [], coverageAssessment: 'none' };
        } else if (action.id === META_ACTION_IDS.SELECT) {
          outputs['selection'] = { decision: 'create-exploratory', rationale: 'no match' };
        } else if (action.id === META_ACTION_IDS.EXECUTE) {
          // Always produce a sub-objective — this will recurse until depth limit
          subCounter++;
          const idx = Math.min(subCounter, descriptions.length - 1);
          outputs['executionResult'] = { outcomes: [] };
          outputs['__subObjectives'] = [{
            id: `sub-${subCounter}`,
            name: `Sub ${subCounter}`,
            description: descriptions[idx] + ` (variant ${subCounter})`,
            contextId: root.id,
            acceptanceCriteria: ['Done'],
            isLearningObjective: false,
            priority: 1,
            status: 'defined' as const,
          }];
        } else if (action.id === META_ACTION_IDS.INCORPORATE) {
          outputs['incorporation'] = {
            updates: {},
            objectiveStatus: 'in-progress',
          };
        }

        return { outputs, validationResults: [] };
      },
    };

    const orchestrator = new Orchestrator(
      engine,
      executor,
      oc.unitStore,
      { recursionGuard: new RecursionGuard({ maxDepth: 3, cycleSimilarityThreshold: 0.9 }) },
    );

    const top: Objective = {
      id: 'depth-top',
      name: 'Top',
      description: 'Start exploring novel machine learning research areas we have not covered',
      contextId: root.id,
      acceptanceCriteria: ['Done'],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    };

    const result = await orchestrator.orchestrate(top);

    // Walk the sub-objective chain and find the depth-limit-reached node
    let cur = result;
    let chain: string[] = [];
    while (cur.subObjectives.length > 0) {
      cur = cur.subObjectives[0];
      chain.push(cur.status);
    }
    // Chain should end with depth-limit-reached
    expect(chain[chain.length - 1]).toBe('depth-limit-reached');
    expect(chain.length).toBeLessThanOrEqual(4); // depth limit of 3 + one reject
  });

  it('throws when meta-actions are not seeded', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    // Deliberately do NOT seed meta-actions

    const engine = new DAGEngine();
    const executor = makeMockExecutor();
    const orchestrator = new Orchestrator(engine, executor, oc.unitStore);

    const objective: Objective = {
      id: 'orphan',
      name: 'Orphan',
      description: 'Will fail because meta-actions missing',
      contextId: root.id,
      acceptanceCriteria: [],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    };

    const result = await orchestrator.orchestrate(objective);
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('meta:classify-objective');
  });

  it('reports failure when a meta-action fails', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    await oc.seedMetaActions(root.id);

    const engine = new DAGEngine();
    const executor = makeMockExecutor({ failAction: META_ACTION_IDS.SEARCH });
    const orchestrator = new Orchestrator(engine, executor, oc.unitStore);

    const objective: Objective = {
      id: 'fail-1',
      name: 'Will fail',
      description: 'Testing the failure path',
      contextId: root.id,
      acceptanceCriteria: [],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    };

    const result = await orchestrator.orchestrate(objective);
    expect(result.status).toBe('failed');
    // Classify and clarify should have succeeded; search failed; select/execute/incorporate
    // never became ready because search didn't produce its output
    const nodesExecuted = [...result.metaPlan.nodes.values()].filter(
      (n) => n.attempts.length > 0,
    );
    expect(nodesExecuted.length).toBeLessThanOrEqual(3);
  });

  it('maintains cross-plan registry of active plans', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    await oc.seedMetaActions(root.id);

    const engine = new DAGEngine();
    const executor = makeMockExecutor();
    const orchestrator = new Orchestrator(engine, executor, oc.unitStore);

    const obj: Objective = {
      id: 'reg-1',
      name: 'Test',
      description: 'Register this plan for tracking',
      contextId: root.id,
      acceptanceCriteria: [],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    };

    await orchestrator.orchestrate(obj);
    expect(orchestrator.getActivePlans()).toHaveLength(1);

    orchestrator.releasePlan(`meta-plan:${obj.id}`);
    expect(orchestrator.getActivePlans()).toHaveLength(0);
  });
});
