/**
 * DAG Engine: structural validation and execution orchestration.
 *
 * Guarantees:
 * - No dangling inputs (every required input is connected)
 * - No cycles
 * - Valid state transitions
 * - Nodes execute only when all required inputs are available
 * - Prioritization: highest risk and/or highest delivered value first
 *
 * The engine does NOT perform actions itself — it determines which nodes
 * are ready, manages state transitions, and tracks results. The actual
 * execution of actions is delegated to an ActionExecutor.
 */

import type {
  PlanDAG,
  PlanNode,
  PlanEdge,
  NodeStatus,
  PlanStatus,
  AttemptRecord,
  ValidationResult,
  ExternalInput,
  SerializablePlanDAG,
  NodeLearning,
} from './plan-dag.js';
import type { ActionDefinition } from './action-model.js';

// ---------------------------------------------------------------------------
// Validation Errors
// ---------------------------------------------------------------------------

export interface DAGValidationError {
  type: 'dangling-input' | 'cycle' | 'missing-action' | 'type-mismatch'
      | 'duplicate-edge' | 'self-loop' | 'orphan-node';
  nodeId?: string;
  edgeId?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Action Executor Interface
// ---------------------------------------------------------------------------

/**
 * Executes an action node. Implemented by the caller — the engine
 * delegates actual work through this interface.
 */
export interface ActionExecutor {
  execute(
    node: PlanNode,
    inputs: Record<string, unknown>,
  ): Promise<{
    outputs: Record<string, unknown>;
    validationResults: ValidationResult[];
    error?: string;
    executionMeta?: Record<string, unknown>;
  }>;
}

// ---------------------------------------------------------------------------
// DAG Engine
// ---------------------------------------------------------------------------

export class DAGEngine {
  // ── Structural Validation ────────────────────────────────────────────

  /**
   * Validate the structural integrity of a plan DAG.
   * Returns an array of errors (empty = valid).
   */
  validate(dag: PlanDAG): DAGValidationError[] {
    const errors: DAGValidationError[] = [];

    errors.push(...this.checkDanglingInputs(dag));
    errors.push(...this.checkCycles(dag));
    errors.push(...this.checkDuplicateEdges(dag));
    errors.push(...this.checkSelfLoops(dag));
    errors.push(...this.checkOrphanNodes(dag));

    return errors;
  }

  /**
   * Validate and update the plan status to 'valid' if no errors.
   * Throws if validation fails.
   */
  validateAndSeal(dag: PlanDAG): DAGValidationError[] {
    const errors = this.validate(dag);
    if (errors.length === 0) {
      dag.status = 'valid';
    }
    return errors;
  }

  // ── Node State Management ────────────────────────────────────────────

  /**
   * Determine which nodes are ready to execute.
   * A node is ready when:
   * - Its status is 'pending'
   * - All required inputs are available (from completed upstream nodes or external inputs)
   *
   * Returns nodes sorted by priority: highest risk first, then highest value.
   */
  getReadyNodes(dag: PlanDAG): PlanNode[] {
    const ready: PlanNode[] = [];

    for (const node of dag.nodes.values()) {
      if (node.status !== 'pending') continue;

      if (this.areInputsAvailable(dag, node)) {
        node.status = 'ready';
        ready.push(node);
      }
    }

    // Sort: highest risk first (fail fast), then highest value
    ready.sort((a, b) => {
      if (b.risk !== a.risk) return b.risk - a.risk;
      return b.value - a.value;
    });

    return ready;
  }

  /**
   * Gather the resolved input values for a node.
   */
  resolveInputs(dag: PlanDAG, node: PlanNode): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};

    // From edges (upstream node outputs)
    for (const edge of dag.edges) {
      if (edge.targetNodeId !== node.id) continue;

      const sourceNode = dag.nodes.get(edge.sourceNodeId);
      if (!sourceNode) continue;

      // Get the latest successful attempt's output
      const lastSuccess = [...sourceNode.attempts]
        .reverse()
        .find((a) => a.status === 'succeeded');

      if (lastSuccess && edge.sourceOutput in lastSuccess.outputs) {
        inputs[edge.targetInput] = lastSuccess.outputs[edge.sourceOutput];
      }
    }

    // From external inputs
    for (const ext of dag.externalInputs) {
      if (ext.targetNodeId === node.id && ext.available) {
        inputs[ext.targetInput] = ext.resourceId ?? ext.description;
      }
    }

    return inputs;
  }

  /**
   * Record the start of a node execution attempt.
   */
  startNode(dag: PlanDAG, nodeId: string): AttemptRecord {
    const node = dag.nodes.get(nodeId);
    if (!node) throw new Error(`Node '${nodeId}' not found`);

    this.assertTransition(node.status, 'executing');
    node.status = 'executing';
    node.attemptCount++;

    const attempt: AttemptRecord = {
      attemptNumber: node.attemptCount,
      startedAt: Date.now(),
      status: 'running',
      outputs: {},
      validationResults: [],
    };
    node.attempts.push(attempt);

    if (dag.status === 'valid' || dag.status === 'interrupted') {
      dag.status = 'executing';
    }

    return attempt;
  }

  /**
   * Record successful completion of a node.
   */
  completeNode(
    dag: PlanDAG,
    nodeId: string,
    outputs: Record<string, unknown>,
    validationResults: ValidationResult[],
    executionMeta?: Record<string, unknown>,
  ): void {
    const node = dag.nodes.get(nodeId);
    if (!node) throw new Error(`Node '${nodeId}' not found`);

    const attempt = node.attempts[node.attempts.length - 1];
    if (!attempt || attempt.status !== 'running') {
      throw new Error(`Node '${nodeId}' has no running attempt`);
    }

    attempt.completedAt = Date.now();
    attempt.outputs = outputs;
    attempt.validationResults = validationResults;
    attempt.executionMeta = executionMeta;

    // Check if all blocking validations passed
    const blockingFailure = validationResults.find((v) => !v.passed && this.isBlocking(v));
    if (blockingFailure) {
      attempt.status = 'failed';
      attempt.error = `Validation failed: ${blockingFailure.detail ?? blockingFailure.validationId}`;
      this.handleNodeFailure(dag, node);
    } else {
      attempt.status = 'succeeded';
      node.status = 'completed';

      // Skip alternative nodes in the same output group
      if (node.outputGroup) {
        this.skipAlternatives(dag, node);
      }
    }

    this.updatePlanStatus(dag);
  }

  /**
   * Record a node failure.
   */
  failNode(dag: PlanDAG, nodeId: string, error: string): void {
    const node = dag.nodes.get(nodeId);
    if (!node) throw new Error(`Node '${nodeId}' not found`);

    const attempt = node.attempts[node.attempts.length - 1];
    if (attempt && attempt.status === 'running') {
      attempt.completedAt = Date.now();
      attempt.status = 'failed';
      attempt.error = error;
    }

    this.handleNodeFailure(dag, node);
    this.updatePlanStatus(dag);
  }

  /**
   * Interrupt a node (risk indicator triggered).
   */
  interruptNode(dag: PlanDAG, nodeId: string, riskIndicatorId: string): void {
    const node = dag.nodes.get(nodeId);
    if (!node) throw new Error(`Node '${nodeId}' not found`);

    const attempt = node.attempts[node.attempts.length - 1];
    if (attempt && attempt.status === 'running') {
      attempt.completedAt = Date.now();
      attempt.status = 'interrupted';
      attempt.triggeredRiskIndicator = riskIndicatorId;
    }

    node.status = 'interrupted';
    dag.status = 'interrupted';
  }

  // ── Execution Orchestration ──────────────────────────────────────────

  /**
   * Execute one round: find ready nodes, execute them (via the executor),
   * record results. Returns the nodes that were executed.
   *
   * Call this in a loop until no more nodes are ready or the plan is
   * complete/failed/interrupted.
   */
  async executeRound(
    dag: PlanDAG,
    executor: ActionExecutor,
  ): Promise<PlanNode[]> {
    const ready = this.getReadyNodes(dag);
    if (ready.length === 0) return [];

    const executed: PlanNode[] = [];

    // Execute ready nodes (could be parallelized in future)
    for (const node of ready) {
      // Node may have been skipped by a previous node in this round (e.g., alternatives)
      if (node.status === 'skipped' || node.status === 'completed') {
        continue;
      }

      // Check risk indicators before executing
      if (this.shouldInterrupt(node)) {
        const indicator = node.action?.riskIndicators.find(
          (ri) => ri.type === 'attempt-count' &&
            ri.threshold != null &&
            node.attemptCount >= ri.threshold,
        );
        if (indicator) {
          this.interruptNode(dag, node.id, indicator.id);
          executed.push(node);
          continue;
        }
      }

      const inputs = this.resolveInputs(dag, node);
      this.startNode(dag, node.id);

      try {
        const result = await executor.execute(node, inputs);

        if (result.error) {
          this.failNode(dag, node.id, result.error);
        } else {
          this.completeNode(
            dag,
            node.id,
            result.outputs,
            result.validationResults,
            result.executionMeta,
          );
        }
      } catch (err) {
        this.failNode(dag, node.id, err instanceof Error ? err.message : String(err));
      }

      executed.push(node);
    }

    return executed;
  }

  /**
   * Execute the full plan to completion (or failure/interruption).
   * Runs rounds until no more nodes are ready.
   */
  async executePlan(
    dag: PlanDAG,
    executor: ActionExecutor,
  ): Promise<void> {
    // Validate first
    const errors = this.validate(dag);
    if (errors.length > 0 && dag.status === 'draft') {
      throw new Error(
        `Cannot execute invalid plan: ${errors.map((e) => e.message).join('; ')}`,
      );
    }

    dag.status = 'executing';

    let rounds = 0;
    const maxRounds = dag.nodes.size * 3; // Safety limit

    while (rounds < maxRounds) {
      const executed = await this.executeRound(dag, executor);
      if (executed.length === 0) break;
      rounds++;

      // Check if plan is done (status may have been updated by executeRound)
      if (this.isTerminal(dag)) break;
    }

    this.updatePlanStatus(dag);
  }

  // ── Private: Validation Checks ───────────────────────────────────────

  private checkDanglingInputs(dag: PlanDAG): DAGValidationError[] {
    const errors: DAGValidationError[] = [];

    for (const node of dag.nodes.values()) {
      if (!node.action) continue;

      for (const input of node.action.inputs) {
        if (!input.required) continue;

        // Check if this input is satisfied by an edge or external input
        const hasEdge = dag.edges.some(
          (e) => e.targetNodeId === node.id && e.targetInput === input.name,
        );
        const hasExternal = dag.externalInputs.some(
          (e) => e.targetNodeId === node.id && e.targetInput === input.name,
        );

        if (!hasEdge && !hasExternal) {
          errors.push({
            type: 'dangling-input',
            nodeId: node.id,
            message: `Node '${node.id}' has unsatisfied required input '${input.name}'`,
          });
        }
      }
    }

    return errors;
  }

  private checkCycles(dag: PlanDAG): DAGValidationError[] {
    // Topological sort using Kahn's algorithm
    const inDegree = new Map<string, number>();
    for (const id of dag.nodes.keys()) inDegree.set(id, 0);
    for (const edge of dag.edges) {
      inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    let visited = 0;
    while (queue.length > 0) {
      const id = queue.shift()!;
      visited++;
      for (const edge of dag.edges) {
        if (edge.sourceNodeId !== id) continue;
        const newDegree = (inDegree.get(edge.targetNodeId) ?? 1) - 1;
        inDegree.set(edge.targetNodeId, newDegree);
        if (newDegree === 0) queue.push(edge.targetNodeId);
      }
    }

    if (visited < dag.nodes.size) {
      return [{
        type: 'cycle',
        message: `Plan DAG contains a cycle (${dag.nodes.size - visited} nodes involved)`,
      }];
    }

    return [];
  }

  private checkDuplicateEdges(dag: PlanDAG): DAGValidationError[] {
    const seen = new Set<string>();
    const errors: DAGValidationError[] = [];

    for (const edge of dag.edges) {
      const key = `${edge.sourceNodeId}:${edge.sourceOutput}->${edge.targetNodeId}:${edge.targetInput}`;
      if (seen.has(key)) {
        errors.push({
          type: 'duplicate-edge',
          edgeId: edge.id,
          message: `Duplicate edge: ${key}`,
        });
      }
      seen.add(key);
    }

    return errors;
  }

  private checkSelfLoops(dag: PlanDAG): DAGValidationError[] {
    return dag.edges
      .filter((e) => e.sourceNodeId === e.targetNodeId)
      .map((e) => ({
        type: 'self-loop' as const,
        edgeId: e.id,
        nodeId: e.sourceNodeId,
        message: `Self-loop on node '${e.sourceNodeId}'`,
      }));
  }

  private checkOrphanNodes(dag: PlanDAG): DAGValidationError[] {
    if (dag.nodes.size <= 1) return [];

    const connected = new Set<string>();
    for (const edge of dag.edges) {
      connected.add(edge.sourceNodeId);
      connected.add(edge.targetNodeId);
    }
    for (const ext of dag.externalInputs) {
      connected.add(ext.targetNodeId);
    }

    const errors: DAGValidationError[] = [];
    for (const [id, node] of dag.nodes) {
      if (connected.has(id)) continue;

      // A node with no required inputs and no edges is a standalone root — valid.
      // This covers: alternative approaches, independent actions, entry points.
      const hasRequiredInputs = node.action?.inputs.some((i) => i.required) ?? false;
      if (!hasRequiredInputs) continue;

      // Node has required inputs but no edges/externals providing them → orphan
      errors.push({
        type: 'orphan-node',
        nodeId: id,
        message: `Node '${id}' is disconnected from the DAG`,
      });
    }

    return errors;
  }

  // ── Private: State Management ────────────────────────────────────────

  private areInputsAvailable(dag: PlanDAG, node: PlanNode): boolean {
    // Check edges: all source nodes must be completed
    const requiredEdges = dag.edges.filter((e) => e.targetNodeId === node.id);
    for (const edge of requiredEdges) {
      const source = dag.nodes.get(edge.sourceNodeId);
      if (!source || source.status !== 'completed') return false;
    }

    // Check external inputs: all must be available
    const requiredExternal = dag.externalInputs.filter(
      (e) => e.targetNodeId === node.id,
    );
    for (const ext of requiredExternal) {
      if (!ext.available) return false;
    }

    return true;
  }

  private assertTransition(from: NodeStatus, to: NodeStatus): void {
    const validTransitions: Record<NodeStatus, NodeStatus[]> = {
      pending: ['ready', 'skipped'],
      ready: ['executing', 'skipped'],
      executing: ['validating', 'completed', 'failed', 'interrupted'],
      validating: ['completed', 'failed'],
      completed: [],
      failed: ['pending'], // Retry: failed → pending → ready → executing
      interrupted: ['pending', 'skipped'], // Resume or skip
      skipped: [],
    };

    if (!validTransitions[from]?.includes(to)) {
      throw new Error(`Invalid state transition: ${from} → ${to}`);
    }
  }

  private handleNodeFailure(dag: PlanDAG, node: PlanNode): void {
    const maxAttempts = node.action?.maxAttempts ?? 1;
    if (node.attemptCount < maxAttempts) {
      // Agent has attempt budget remaining — reset to pending so the executor
      // can try again (potentially with a different approach). The executor
      // should use the attempt history to vary its strategy.
      node.status = 'pending';
    } else {
      // Attempt budget exhausted — failure propagates to parent context.
      // This is not a mechanical retry limit but a signal that the action
      // definition may need revision or an alternative approach is needed.
      node.status = 'failed';
    }
  }

  private skipAlternatives(dag: PlanDAG, completedNode: PlanNode): void {
    for (const node of dag.nodes.values()) {
      if (
        node.id !== completedNode.id &&
        node.outputGroup === completedNode.outputGroup &&
        (node.status === 'pending' || node.status === 'ready')
      ) {
        node.status = 'skipped';
      }
    }
  }

  private updatePlanStatus(dag: PlanDAG): void {
    const statuses = [...dag.nodes.values()].map((n) => n.status);

    if (statuses.every((s) => s === 'completed' || s === 'skipped')) {
      dag.status = 'completed';
      return;
    }

    if (statuses.some((s) => s === 'interrupted')) {
      dag.status = 'interrupted';
      return;
    }

    if (statuses.some((s) => s === 'failed')) {
      // Check if any pending/ready nodes could still execute.
      // If all remaining pending nodes are blocked by failed upstream nodes, the plan is failed.
      const hasExecutableWork = statuses.some((s) => s === 'executing') ||
        this.hasUnblockedPendingNodes(dag);

      if (!hasExecutableWork) {
        dag.status = 'failed';
        return;
      }
    }
    // Otherwise remain 'executing'
  }

  /**
   * Check if there are any pending nodes whose inputs could still be satisfied.
   * A pending node is blocked if any of its transitive upstream dependencies
   * has failed. Performs a transitive walk, not just direct upstream check.
   */
  private hasUnblockedPendingNodes(dag: PlanDAG): boolean {
    // Memoize blocking status per node
    const blockingStatus = new Map<string, boolean>();

    const isBlocked = (nodeId: string, visiting: Set<string>): boolean => {
      const cached = blockingStatus.get(nodeId);
      if (cached !== undefined) return cached;

      // Guard against cycles (shouldn't happen in a DAG, but defensive)
      if (visiting.has(nodeId)) return false;
      visiting.add(nodeId);

      const node = dag.nodes.get(nodeId);
      if (!node) {
        blockingStatus.set(nodeId, true);
        return true;
      }

      // A failed node blocks anything downstream
      if (node.status === 'failed') {
        blockingStatus.set(nodeId, true);
        return true;
      }

      // Completed/skipped nodes don't block
      if (node.status === 'completed' || node.status === 'skipped') {
        blockingStatus.set(nodeId, false);
        return false;
      }

      // Pending/ready/executing/etc: check all upstream edges transitively
      const upstreamEdges = dag.edges.filter((e) => e.targetNodeId === nodeId);
      for (const edge of upstreamEdges) {
        if (isBlocked(edge.sourceNodeId, visiting)) {
          blockingStatus.set(nodeId, true);
          return true;
        }
      }

      blockingStatus.set(nodeId, false);
      return false;
    };

    for (const node of dag.nodes.values()) {
      if (node.status !== 'pending') continue;
      if (!isBlocked(node.id, new Set())) return true;
    }
    return false;
  }

  private shouldInterrupt(node: PlanNode): boolean {
    if (!node.action?.riskIndicators) return false;

    return node.action.riskIndicators.some((ri) => {
      if (ri.type === 'attempt-count' && ri.threshold != null) {
        return node.attemptCount >= ri.threshold;
      }
      return false;
    });
  }

  private isTerminal(dag: PlanDAG): boolean {
    const s = dag.status as string;
    return s === 'completed' || s === 'failed' || s === 'interrupted';
  }

  private isBlocking(vr: ValidationResult): boolean {
    // All validations are blocking by default in this implementation.
    // The action definition's validations specify blocking, but we
    // don't have that context here — caller should filter.
    return !vr.passed;
  }
}
