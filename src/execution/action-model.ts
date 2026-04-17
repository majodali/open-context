/**
 * Action Model
 *
 * Describes what can be done. Each action has typed inputs and outputs
 * (defined in terms of the domain model), one or more performers
 * (agent, human, tool), parameters, instructions, and validation criteria.
 *
 * Actions ARE bounded contexts — they define all the inputs and instructions
 * required to produce an output. If an action fails, either the wrong action
 * was chosen or the action definition must be updated.
 *
 * Multiple actions may produce similar outputs — the planner chooses
 * between them based on context, risk, and value.
 */

// ---------------------------------------------------------------------------
// Action Definition
// ---------------------------------------------------------------------------

/**
 * Who or what performs the action.
 * - agent: an AI agent (with model and prompt configuration)
 * - human: a human user (the system requests and waits for human input)
 * - tool: a program, service, or API call
 */
export type PerformerType = 'agent' | 'human' | 'tool';

/**
 * An action definition — a reusable specification of something that can be done.
 *
 * Actions reference the domain model for their inputs and outputs.
 * They include everything needed for execution: instructions, parameters,
 * validation criteria, and risk indicators.
 */
export interface ActionDefinition {
  /** Unique identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** What this action does. */
  description: string;
  /** The bounded context this action operates within. */
  contextId: string;

  // -- Inputs and Outputs --

  /**
   * Required inputs — each references a domain entity or resource type.
   * The action cannot execute until all required inputs are available.
   */
  inputs: ActionPort[];
  /**
   * Outputs produced by this action.
   * These become available as inputs for downstream actions.
   */
  outputs: ActionPort[];

  // -- Execution --

  /** Who/what performs this action. */
  performer: PerformerSpec;
  /** Instructions for the performer (natural language, prompt, command, etc.). */
  instructions: string;
  /**
   * Parameters that modify how the action is performed.
   * e.g., model temperature, timeout, retry count.
   */
  parameters: ActionParameter[];

  // -- Validation --

  /**
   * Criteria for validating the action's outputs.
   * Can be formal (type check, assertion) or descriptive (natural language criteria
   * for an agent to evaluate).
   */
  validations: ActionValidation[];

  // -- Risk and Control --

  /**
   * Indicators that the action is not going to plan.
   * When triggered, the action should be interrupted and the planner notified.
   */
  riskIndicators: RiskIndicator[];
  /**
   * Guidance for the performing agent on how much effort to invest.
   * This is NOT a mechanical retry counter — it tells the agent how many
   * different approaches to try before reporting failure to the parent context.
   * The agent uses judgment about whether to vary its approach between attempts.
   * When this budget is spent, the failure propagates up for replanning.
   * Default 1 (single attempt, escalate on failure).
   */
  maxAttempts: number;
  /** Estimated cost/effort (arbitrary units, for prioritization). */
  estimatedCost?: number;
  /** Expected value of the output (arbitrary units, for prioritization). */
  estimatedValue?: number;

  // -- Knowledge Retrieval --

  /**
   * Query templates that define what knowledge this action needs.
   * When provided, these are used instead of (or in addition to) the
   * QueryConstructor's auto-generated queries.
   *
   * Each template specifies a purpose, a query pattern, and optional
   * filters. Query patterns can include placeholders referencing
   * action inputs, e.g., "Authentication requirements for {{auth-spec}}".
   *
   * Over time, query templates are refined based on feedback about
   * what knowledge was actually useful vs. missing.
   */
  queryTemplates?: ActionQueryTemplate[];

  // -- Metadata --

  /** Tags for classification and retrieval. */
  tags: string[];
  /**
   * Alternative action IDs that can produce similar outputs.
   * The planner may choose between alternatives based on context.
   */
  alternatives?: string[];
}

/**
 * A query template attached to an action definition.
 * Defines a specific knowledge retrieval to perform before execution.
 */
export interface ActionQueryTemplate {
  /** Purpose identifier — used in feedback tracking. */
  purpose: string;
  /**
   * The query text. May contain {{placeholder}} references to input port
   * names, which are resolved from the action's inputs before execution.
   * e.g., "Testing methodology for {{auth-spec}} using BDD approach"
   */
  query: string;
  /** Maximum units to retrieve for this query. */
  maxResults?: number;
  /** Content type filter. */
  contentTypes?: string[];
  /** Tag filter — units must have at least one of these tags. */
  tags?: string[];
  /**
   * Override the context to query from. If not set, uses the action's contextId.
   * Can be 'root' to query from the root context (useful for cross-cutting concerns).
   */
  contextOverride?: string;
  /** Priority relative to other templates (higher = more important). */
  priority?: number;
}

/**
 * An input or output port on an action.
 * References the domain model for type information.
 */
export interface ActionPort {
  /** Name of this port (unique within the action's inputs or outputs). */
  name: string;
  /** Description of what this port carries. */
  description: string;
  /** ResourceType ID that defines the type of this port. */
  resourceTypeId?: string;
  /** Specific Resource ID if this refers to a specific resource instance. */
  resourceId?: string;
  /** Whether this port is required (for inputs) or guaranteed (for outputs). */
  required: boolean;
  /**
   * For quantifiable resource types: how much is needed (input) or produced (output).
   * References the unit defined on the ResourceType.
   */
  requiredQuantity?: number;
}

/**
 * Specification of who/what performs the action.
 */
export interface PerformerSpec {
  type: PerformerType;
  /** For agents: model identifier, role ID, or agent configuration. */
  agentConfig?: {
    model?: string;
    roleId?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
  };
  /** For tools: tool name, command, endpoint, etc. */
  toolConfig?: {
    toolName: string;
    command?: string;
    endpoint?: string;
    config?: Record<string, unknown>;
  };
  /** For humans: instructions for what the human should do. */
  humanConfig?: {
    prompt: string;
    expectedFormat?: string;
    timeout?: number;
  };
}

export interface ActionParameter {
  name: string;
  description: string;
  type?: string;
  default?: unknown;
  /** Valid values or range. */
  constraints?: string;
}

/**
 * Validation criterion for an action's outputs.
 * Can be formal or descriptive.
 */
export interface ActionValidation {
  id: string;
  /** What to validate. */
  description: string;
  /**
   * How to validate:
   * - 'assertion': a programmatic check (expression evaluated against output)
   * - 'agent-review': an agent evaluates the output against the description
   * - 'human-review': a human evaluates
   * - 'test': an automated test is run
   */
  method: 'assertion' | 'agent-review' | 'human-review' | 'test';
  /** For assertions: the expression to evaluate. */
  expression?: string;
  /** Whether failure of this validation should halt execution. */
  blocking: boolean;
}

/**
 * An indicator that something is going wrong during execution.
 * When triggered, the action should be interrupted.
 */
export interface RiskIndicator {
  id: string;
  description: string;
  /**
   * What to check:
   * - 'attempt-count': triggered when attempts exceed threshold
   * - 'duration': triggered when execution time exceeds threshold
   * - 'output-pattern': triggered when output matches a pattern (e.g., error pattern)
   * - 'metric': triggered when a metric exceeds/falls below threshold
   * - 'custom': agent evaluates whether the indicator is triggered
   */
  type: 'attempt-count' | 'duration' | 'output-pattern' | 'metric' | 'custom';
  /** Threshold value (interpretation depends on type). */
  threshold?: number;
  /** Pattern to match (for output-pattern type). */
  pattern?: string;
  /** What to do when triggered. */
  response: 'interrupt' | 'warn' | 'escalate';
}
