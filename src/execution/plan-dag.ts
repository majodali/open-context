/**
 * Planning-Execution-Learning Model: the formal DAG.
 *
 * A plan is a DAG of action nodes connected by input/output dependencies.
 * The system guarantees structural correctness:
 * - No dangling inputs (every required input is produced by an upstream node or available externally)
 * - No cycles
 * - Valid state transitions
 * - Consistency between node inputs/outputs and action definitions
 *
 * The DAG tracks execution state, results, and learnings at each node.
 * It is the authoritative record of what was planned, what happened, and what was learned.
 */

import type { ActionDefinition, ActionPort } from './action-model.js';

// ---------------------------------------------------------------------------
// Objective
// ---------------------------------------------------------------------------

/**
 * An objective — what we're trying to achieve.
 * Objectives decompose into plans (DAGs of actions).
 */
export interface Objective {
  id: string;
  name: string;
  description: string;
  /** The bounded context this objective belongs to. */
  contextId: string;
  /** Parent objective, if this is a sub-objective. */
  parentObjectiveId?: string;
  /** Acceptance criteria — how we know the objective is met. */
  acceptanceCriteria: string[];
  /** Whether this is a learning objective (exploring how to do something). */
  isLearningObjective: boolean;
  /** Priority relative to sibling objectives. */
  priority: number;
  /** Current status. */
  status: ObjectiveStatus;
}

export type ObjectiveStatus =
  | 'defined'       // Objective stated but not yet planned
  | 'planning'      // Plan is being constructed
  | 'ready'         // Plan constructed, ready to execute
  | 'executing'     // Execution in progress
  | 'validating'    // Execution complete, validating results
  | 'completed'     // Objective met
  | 'failed'        // Objective could not be met
  | 'superseded';   // Replaced by a revised objective

// ---------------------------------------------------------------------------
// Plan DAG
// ---------------------------------------------------------------------------

/**
 * A plan — a directed acyclic graph of action nodes.
 * The plan is the authoritative specification of how to deliver an objective.
 */
export interface PlanDAG {
  id: string;
  /** The objective this plan delivers. */
  objectiveId: string;
  /** The bounded context. */
  contextId: string;

  /** All nodes in the DAG. */
  nodes: Map<string, PlanNode>;
  /** Edges: source node output → target node input. */
  edges: PlanEdge[];

  /** Resources available externally (not produced by any node). */
  externalInputs: ExternalInput[];

  /** Assumptions the plan is based on. */
  assumptions: Assumption[];

  /** Plan metadata. */
  revision: number;
  createdAt: number;
  updatedAt: number;
  status: PlanStatus;
}

export type PlanStatus =
  | 'draft'        // Under construction, may be structurally incomplete
  | 'valid'        // Structurally complete and consistent
  | 'executing'    // Execution in progress
  | 'completed'    // All nodes completed successfully
  | 'failed'       // One or more nodes failed terminally
  | 'interrupted'  // Execution paused due to risk indicator or manual intervention
  | 'superseded';  // Replaced by a revised plan

/**
 * A node in the plan DAG — an action to be executed.
 */
export interface PlanNode {
  id: string;
  /** The action definition this node executes. */
  actionId: string;
  /**
   * Action definition snapshot — may be inlined for self-containment,
   * or referenced by ID from the knowledge base.
   */
  action?: ActionDefinition;

  // -- Execution State --

  status: NodeStatus;
  /** Current attempt number (1-indexed). */
  attemptCount: number;
  /** Results from each attempt. */
  attempts: AttemptRecord[];

  // -- Planning Metadata --

  /**
   * Which approach this node represents, if the plan has alternatives.
   * Nodes with the same outputGroup produce equivalent outputs —
   * only one needs to succeed.
   */
  outputGroup?: string;
  /** Estimated risk (0–1). Higher = should execute earlier for fast feedback. */
  risk: number;
  /** Estimated value of this node's outputs (arbitrary units). */
  value: number;
  /** Whether this node has been fully expanded (sub-objectives planned). */
  expanded: boolean;
  /** Child plan ID, if this node decomposes into a sub-plan. */
  childPlanId?: string;
}

export type NodeStatus =
  | 'pending'       // Waiting for inputs
  | 'ready'         // All inputs available, can execute
  | 'executing'     // Currently running
  | 'validating'    // Execution done, validating outputs
  | 'completed'     // Outputs validated successfully
  | 'failed'        // Failed after all attempts exhausted
  | 'interrupted'   // Stopped by risk indicator
  | 'skipped';      // Skipped (alternative succeeded, or no longer needed)

/**
 * A directed edge connecting a source node's output to a target node's input.
 */
export interface PlanEdge {
  id: string;
  /** Source node ID. */
  sourceNodeId: string;
  /** Source output port name. */
  sourceOutput: string;
  /** Target node ID. */
  targetNodeId: string;
  /** Target input port name. */
  targetInput: string;
}

/**
 * An input available from outside the plan (not produced by any node).
 * e.g., user requirements, existing codebase, configuration.
 */
export interface ExternalInput {
  /** The input port name on the target node. */
  targetNodeId: string;
  targetInput: string;
  /** Domain resource ID or description of what's provided. */
  resourceId?: string;
  description: string;
  /** Whether this input is currently available. */
  available: boolean;
}

/**
 * An assumption the plan depends on.
 * If an assumption proves false, the plan may need revision.
 */
export interface Assumption {
  id: string;
  description: string;
  /** How confident we are (0–1). */
  confidence: number;
  /** What to do if this assumption fails. */
  mitigationStrategy?: string;
  /** Whether this assumption has been validated. */
  validated?: boolean;
}

// ---------------------------------------------------------------------------
// Execution Records
// ---------------------------------------------------------------------------

/**
 * Record of a single attempt to execute a node.
 */
export interface AttemptRecord {
  attemptNumber: number;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'succeeded' | 'failed' | 'interrupted';

  /** Outputs produced (keyed by output port name). */
  outputs: Record<string, unknown>;
  /** Validation results. */
  validationResults: ValidationResult[];

  /** If failed: what went wrong. */
  error?: string;
  /** If interrupted: which risk indicator triggered. */
  triggeredRiskIndicator?: string;

  /** Raw execution metadata (token counts, latency, etc.). */
  executionMeta?: Record<string, unknown>;
}

export interface ValidationResult {
  validationId: string;
  passed: boolean;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Learning Records (attached to nodes)
// ---------------------------------------------------------------------------

/**
 * Learning produced from a node's execution.
 * Captures what happened, why, and what should change.
 */
export interface NodeLearning {
  nodeId: string;
  /** What was learned. */
  observations: string[];
  /** Changes to recommend. */
  recommendations: LearningRecommendation[];
}

export type LearningRecommendation =
  | { type: 'update-action'; actionId: string; description: string }
  | { type: 'new-objective'; description: string; isLearningObjective: boolean }
  | { type: 'update-domain'; description: string }
  | { type: 'revise-plan'; description: string }
  | { type: 'update-assumption'; assumptionId: string; validated: boolean; description: string };

// ---------------------------------------------------------------------------
// Serializable form (for storage as semantic units)
// ---------------------------------------------------------------------------

/**
 * Serializable version of PlanDAG — nodes stored as array instead of Map.
 * Used for JSON persistence and storage as semantic units.
 */
export interface SerializablePlanDAG extends Omit<PlanDAG, 'nodes'> {
  nodes: PlanNode[];
}

export function serializePlanDAG(dag: PlanDAG): SerializablePlanDAG {
  return {
    ...dag,
    nodes: [...dag.nodes.values()],
  };
}

export function deserializePlanDAG(data: SerializablePlanDAG): PlanDAG {
  const nodes = new Map<string, PlanNode>();
  for (const node of data.nodes) {
    nodes.set(node.id, node);
  }
  return { ...data, nodes };
}
