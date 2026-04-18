/**
 * Event emission for orchestration observation.
 *
 * A minimal pub/sub system for watching orchestration execution in real time.
 * The DAG engine and Orchestrator emit events at key lifecycle points;
 * subscribers receive them synchronously.
 *
 * Events are fire-and-forget — handler errors are caught and logged but don't
 * affect execution. Handlers should avoid long-running work (do async work
 * in a separate task if needed).
 */

import type { PlanDAG, PlanNode, Objective, AttemptRecord } from './plan-dag.js';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type ExecutionEvent =
  | OrchestrationStartedEvent
  | OrchestrationCompletedEvent
  | PlanStartedEvent
  | PlanCompletedEvent
  | NodeStartedEvent
  | NodeAttemptStartedEvent
  | NodeCompletedEvent
  | NodeFailedEvent
  | NodeInterruptedEvent
  | SubObjectiveSpawnedEvent
  | ToolCallEvent
  | QueryEvent;

export interface BaseEvent {
  timestamp: number;
  /** Monotonic sequence number within the session. */
  seq: number;
}

export interface OrchestrationStartedEvent extends BaseEvent {
  type: 'orchestration.started';
  objective: Objective;
  depth: number;
}

export interface OrchestrationCompletedEvent extends BaseEvent {
  type: 'orchestration.completed';
  objectiveId: string;
  status: string;
  reason?: string;
  totalNodesExecuted: number;
  subObjectiveCount: number;
}

export interface PlanStartedEvent extends BaseEvent {
  type: 'plan.started';
  planId: string;
  objectiveId: string;
  nodeCount: number;
}

export interface PlanCompletedEvent extends BaseEvent {
  type: 'plan.completed';
  planId: string;
  status: string;
  durationMs: number;
}

export interface NodeStartedEvent extends BaseEvent {
  type: 'node.started';
  planId: string;
  nodeId: string;
  actionId: string;
  actionName: string;
  attemptNumber: number;
}

export interface NodeAttemptStartedEvent extends BaseEvent {
  type: 'node.attempt';
  planId: string;
  nodeId: string;
  attemptNumber: number;
  previousError?: string;
}

export interface NodeCompletedEvent extends BaseEvent {
  type: 'node.completed';
  planId: string;
  nodeId: string;
  actionId: string;
  durationMs: number;
  outputKeys: string[];
  validationsPassed: number;
  validationsFailed: number;
}

export interface NodeFailedEvent extends BaseEvent {
  type: 'node.failed';
  planId: string;
  nodeId: string;
  actionId: string;
  error: string;
  attemptsUsed: number;
  willRetry: boolean;
}

export interface NodeInterruptedEvent extends BaseEvent {
  type: 'node.interrupted';
  planId: string;
  nodeId: string;
  riskIndicatorId: string;
}

export interface SubObjectiveSpawnedEvent extends BaseEvent {
  type: 'subobjective.spawned';
  parentObjectiveId: string;
  subObjectiveId: string;
  subObjectiveDescription: string;
}

export interface ToolCallEvent extends BaseEvent {
  type: 'tool.call';
  planId: string;
  nodeId: string;
  toolName: string;
  argsPreview: string;
  resultPreview?: string;
  success?: boolean;
}

export interface QueryEvent extends BaseEvent {
  type: 'query';
  planId: string;
  nodeId: string;
  purpose: string;
  query: string;
  unitsReturned: number;
}

// ---------------------------------------------------------------------------
// Event emitter
// ---------------------------------------------------------------------------

export type EventHandler = (event: ExecutionEvent) => void | Promise<void>;

/**
 * Distributive Omit for union types — preserves the discrimination.
 */
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

/**
 * Event input — same as ExecutionEvent but without timestamp and seq
 * (added by the emitter).
 */
export type EventInput = DistributiveOmit<ExecutionEvent, 'timestamp' | 'seq'>;

/**
 * Simple event emitter for execution events.
 * Not tied to Node.js EventEmitter — keeps the library dependency-free.
 */
export class ExecutionEventEmitter {
  private handlers = new Set<EventHandler>();
  private seq = 0;

  /** Subscribe to all events. Returns an unsubscribe function. */
  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Emit an event to all subscribers. */
  emit(event: EventInput): void {
    const fullEvent = {
      ...event,
      timestamp: Date.now(),
      seq: ++this.seq,
    } as ExecutionEvent;

    for (const handler of this.handlers) {
      try {
        const result = handler(fullEvent);
        // If the handler returns a promise, don't await it — fire-and-forget
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => {
            // Swallow handler errors to prevent them affecting execution
            console.error('Event handler error:', err);
          });
        }
      } catch (err) {
        console.error('Event handler error:', err);
      }
    }
  }

  /** Remove all subscribers. */
  clear(): void {
    this.handlers.clear();
  }

  /** Current subscriber count. */
  get subscriberCount(): number {
    return this.handlers.size;
  }
}

// ---------------------------------------------------------------------------
// Convenience: filter events by type
// ---------------------------------------------------------------------------

/**
 * Create a handler that only fires for specific event types.
 */
export function filterEvents<T extends ExecutionEvent['type']>(
  types: T[],
  handler: (event: Extract<ExecutionEvent, { type: T }>) => void,
): EventHandler {
  const typeSet = new Set(types);
  return (event) => {
    if (typeSet.has(event.type as T)) {
      handler(event as Extract<ExecutionEvent, { type: T }>);
    }
  };
}
