/**
 * Orchestrator
 *
 * The orchestrator drives the planning-execution-learning cycle for an objective.
 * It uses the six meta-actions (classify, clarify, search, select, execute,
 * incorporate) as a meta-plan, executing them via the DAG engine.
 *
 * Key behaviors:
 * - Builds a meta-plan DAG for the objective and runs it
 * - For sub-objectives produced by planning actions, recursively orchestrates
 *   them (subject to recursion safety)
 * - Maintains a cross-plan registry of pending nodes that get re-checked
 *   periodically when resources update
 *
 * The orchestrator is itself stateless — state lives in the DAG, knowledge
 * base, and metrics store. The orchestrator is the driver that wires the
 * pieces together for a given objective.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Objective, PlanDAG, PlanNode } from './plan-dag.js';
import type { ActionDefinition } from './action-model.js';
import type { ActionExecutor, DAGEngine } from './dag-engine.js';
import { findActionDefinitionById } from './storage-helpers.js';
import { META_ACTION_IDS } from './meta-actions.js';
import {
  RecursionGuard,
  type ObjectiveLineage,
  type CycleCheckResult,
} from './recursion-safety.js';
import type { UnitStore } from '../storage/unit-store.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface OrchestrationResult {
  /** The objective that was orchestrated. */
  objective: Objective;
  /** The meta-plan DAG that was executed. */
  metaPlan: PlanDAG;
  /** Sub-objectives that were spawned (with their own results). */
  subObjectives: OrchestrationResult[];
  /** Final status. */
  status: 'completed' | 'failed' | 'blocked' | 'depth-limit-reached' | 'cycle-detected';
  /** Reason for non-completion, if applicable. */
  reason?: string;
  /** Total nodes executed across all plans. */
  totalNodesExecuted: number;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface OrchestratorConfig {
  /** Recursion safety configuration. */
  recursionGuard?: RecursionGuard;
  /** Periodic re-evaluation interval for deferred nodes (ms). 0 = disabled. */
  deferredCheckIntervalMs?: number;
  /** Maximum total nodes across all plans (safety limit). */
  maxTotalNodes?: number;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  deferredCheckIntervalMs: 0, // Disabled by default
  maxTotalNodes: 1000,
};

export class Orchestrator {
  private config: OrchestratorConfig;
  private guard: RecursionGuard;
  /** Cross-plan registry of all active plans (for deferred node checking). */
  private activePlans = new Map<string, PlanDAG>();

  constructor(
    private engine: DAGEngine,
    private executor: ActionExecutor,
    private unitStore: UnitStore,
    config?: OrchestratorConfig,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.guard = config?.recursionGuard ?? new RecursionGuard();
  }

  /**
   * Orchestrate an objective: build a meta-plan, execute it, and recursively
   * handle any sub-objectives produced.
   */
  async orchestrate(
    objective: Objective,
    lineage?: ObjectiveLineage,
  ): Promise<OrchestrationResult> {
    const currentLineage = lineage ?? this.guard.rootLineage();

    // Cycle / depth check
    const safety = this.guard.check(objective, currentLineage);
    if (!safety.safe) {
      return {
        objective,
        metaPlan: this.emptyMetaPlan(objective),
        subObjectives: [],
        status: safety.reason === 'depth-exceeded' ? 'depth-limit-reached' : 'cycle-detected',
        reason: safety.detail,
        totalNodesExecuted: 0,
      };
    }

    // Build the meta-plan DAG
    let metaPlan: PlanDAG;
    try {
      metaPlan = await this.buildMetaPlan(objective);
    } catch (err) {
      return {
        objective,
        metaPlan: this.emptyMetaPlan(objective),
        subObjectives: [],
        status: 'failed',
        reason: err instanceof Error ? err.message : String(err),
        totalNodesExecuted: 0,
      };
    }

    // Validate
    const errors = this.engine.validateAndSeal(metaPlan);
    if (errors.length > 0) {
      return {
        objective,
        metaPlan,
        subObjectives: [],
        status: 'failed',
        reason: `Meta-plan validation failed: ${errors.map((e) => e.message).join('; ')}`,
        totalNodesExecuted: 0,
      };
    }

    // Register and execute
    this.activePlans.set(metaPlan.id, metaPlan);

    let totalExecuted = 0;
    try {
      await this.engine.executePlan(metaPlan, this.executor);
      totalExecuted = [...metaPlan.nodes.values()].filter(
        (n) => n.attempts.length > 0,
      ).length;
    } catch (err) {
      return {
        objective,
        metaPlan,
        subObjectives: [],
        status: 'failed',
        reason: err instanceof Error ? err.message : String(err),
        totalNodesExecuted: totalExecuted,
      };
    }

    // Extract sub-objectives that may have been produced
    const subObjectives = this.extractSubObjectives(metaPlan);

    // Recursively orchestrate sub-objectives
    const subResults: OrchestrationResult[] = [];
    const childLineage = this.guard.childLineage(currentLineage, objective);

    for (const subObj of subObjectives) {
      const subResult = await this.orchestrate(subObj, childLineage);
      subResults.push(subResult);
      totalExecuted += subResult.totalNodesExecuted;

      if (totalExecuted >= (this.config.maxTotalNodes ?? Infinity)) {
        return {
          objective,
          metaPlan,
          subObjectives: subResults,
          status: 'failed',
          reason: `Exceeded maxTotalNodes (${this.config.maxTotalNodes})`,
          totalNodesExecuted: totalExecuted,
        };
      }
    }

    // Determine final status from meta-plan and sub-results
    const status = this.determineStatus(metaPlan, subResults);

    return {
      objective,
      metaPlan,
      subObjectives: subResults,
      status,
      totalNodesExecuted: totalExecuted,
    };
  }

  /**
   * Re-check all active plans for newly-ready nodes and execute any that
   * can now proceed. Useful when external resources have been updated.
   * Returns the number of nodes that became ready and were executed.
   */
  async checkDeferredNodes(): Promise<number> {
    let totalExecuted = 0;
    for (const dag of this.activePlans.values()) {
      const executed = await this.engine.executeRound(dag, this.executor);
      totalExecuted += executed.length;
    }
    return totalExecuted;
  }

  /**
   * Get all currently active plans (cross-plan registry).
   */
  getActivePlans(): PlanDAG[] {
    return [...this.activePlans.values()];
  }

  /**
   * Remove a completed/failed plan from the active registry.
   */
  releasePlan(planId: string): void {
    this.activePlans.delete(planId);
  }

  // ── Private: meta-plan construction ────────────────────────────────────

  /**
   * Build the meta-plan DAG for an objective.
   * The plan executes the six meta-actions in sequence:
   * classify → clarify → search → select → execute → incorporate
   *
   * Each meta-action is loaded from the knowledge base by ID.
   */
  private async buildMetaPlan(objective: Objective): Promise<PlanDAG> {
    const metaActionIds = [
      META_ACTION_IDS.CLASSIFY,
      META_ACTION_IDS.CLARIFY,
      META_ACTION_IDS.SEARCH,
      META_ACTION_IDS.SELECT,
      META_ACTION_IDS.EXECUTE,
      META_ACTION_IDS.INCORPORATE,
    ];

    const nodes = new Map<string, PlanNode>();
    const nodeIds: string[] = [];

    for (const actionId of metaActionIds) {
      const action = await findActionDefinitionById(actionId, this.unitStore);
      if (!action) {
        throw new Error(
          `Meta-action '${actionId}' not found in knowledge base. Did you call seedMetaActions()?`,
        );
      }

      const nodeId = `${objective.id}:${actionId.replace(':', '-')}`;
      nodeIds.push(nodeId);
      nodes.set(nodeId, {
        id: nodeId,
        actionId: action.id,
        action,
        status: 'pending',
        attemptCount: 0,
        attempts: [],
        risk: 0.4,
        value: 1,
        expanded: false,
      });
    }

    // Build edges: each step feeds the next
    // Outputs from one action become inputs to the next via standard
    // port-name conventions defined in the meta-actions.
    const edges = [
      this.makeEdge(nodeIds[0], 'classification', nodeIds[1], 'classification'),
      this.makeEdge(nodeIds[1], 'clarifiedObjective', nodeIds[2], 'clarifiedObjective'),
      this.makeEdge(nodeIds[2], 'searchResult', nodeIds[3], 'searchResult'),
      this.makeEdge(nodeIds[3], 'selection', nodeIds[4], 'selection'),
      this.makeEdge(nodeIds[4], 'executionResult', nodeIds[5], 'executionResult'),
      // Clarify also needs original objective; Select also needs clarified objective;
      // Incorporate also needs clarified objective. These are all carried via the
      // first node's external inputs.
    ];

    // The clarify step needs the original objective description too
    edges.push(this.makeEdge(nodeIds[0], '__objectiveDescription', nodeIds[1], 'objectiveDescription'));
    // Select needs clarified objective
    edges.push(this.makeEdge(nodeIds[1], 'clarifiedObjective', nodeIds[3], 'clarifiedObjective'));
    // Incorporate needs clarified objective
    edges.push(this.makeEdge(nodeIds[1], 'clarifiedObjective', nodeIds[5], 'clarifiedObjective'));

    // External inputs to the first node (classify-objective)
    const externalInputs = [
      {
        targetNodeId: nodeIds[0],
        targetInput: 'objectiveDescription',
        description: objective.description,
        available: true,
      },
      {
        targetNodeId: nodeIds[0],
        targetInput: 'targetContextId',
        description: objective.contextId,
        available: true,
      },
    ];

    return {
      id: `meta-plan:${objective.id}`,
      objectiveId: objective.id,
      contextId: objective.contextId,
      nodes,
      edges,
      externalInputs,
      assumptions: [],
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'draft',
    };
  }

  private makeEdge(
    sourceNodeId: string,
    sourceOutput: string,
    targetNodeId: string,
    targetInput: string,
  ) {
    return {
      id: uuidv4(),
      sourceNodeId,
      sourceOutput,
      targetNodeId,
      targetInput,
    };
  }

  /**
   * Extract sub-objectives from a completed meta-plan.
   * Sub-objectives may be embedded in the outputs of execute-actions or
   * incorporate-results steps (when planning actions produced sub-DAGs
   * that include new objectives).
   */
  private extractSubObjectives(metaPlan: PlanDAG): Objective[] {
    const subObjectives: Objective[] = [];

    for (const node of metaPlan.nodes.values()) {
      const lastSuccess = [...node.attempts]
        .reverse()
        .find((a) => a.status === 'succeeded');
      if (!lastSuccess) continue;

      // Look for sub-objectives in the outputs
      const outputs = lastSuccess.outputs;
      if (outputs['__subObjectives'] && Array.isArray(outputs['__subObjectives'])) {
        for (const so of outputs['__subObjectives']) {
          if (this.isObjective(so)) {
            subObjectives.push(so);
          }
        }
      }
    }

    return subObjectives;
  }

  private isObjective(o: unknown): o is Objective {
    return (
      typeof o === 'object' &&
      o !== null &&
      typeof (o as Objective).id === 'string' &&
      typeof (o as Objective).description === 'string'
    );
  }

  private determineStatus(
    metaPlan: PlanDAG,
    subResults: OrchestrationResult[],
  ): OrchestrationResult['status'] {
    if (metaPlan.status === 'failed') return 'failed';
    if (metaPlan.status === 'interrupted') return 'blocked';

    // Check sub-results
    for (const sr of subResults) {
      if (sr.status === 'failed') return 'failed';
      if (sr.status === 'blocked') return 'blocked';
      if (sr.status === 'cycle-detected' || sr.status === 'depth-limit-reached') {
        return sr.status;
      }
    }

    return 'completed';
  }

  private emptyMetaPlan(objective: Objective): PlanDAG {
    return {
      id: `meta-plan:${objective.id}:rejected`,
      objectiveId: objective.id,
      contextId: objective.contextId,
      nodes: new Map(),
      edges: [],
      externalInputs: [],
      assumptions: [],
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'failed',
    };
  }
}
