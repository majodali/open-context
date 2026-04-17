/**
 * Planning and Learning cycle types.
 *
 * Every activity — whether mature or experimental — has a plan that defines
 * what success looks like. Mature activities have expectations (baselines);
 * immature activities have hypotheses (testable predictions). The learning
 * cycle evaluates execution against the plan and produces structured learnings
 * that drive plan revision.
 *
 * Plans, hypotheses, expectations, and learnings are all stored as semantic
 * units (with structured data in their content as JSON), so they're queryable
 * and versionable like any other knowledge.
 */

// ---------------------------------------------------------------------------
// Maturity
// ---------------------------------------------------------------------------

/**
 * How well-understood is this activity?
 * - experimental: first attempt, no established patterns, high uncertainty
 * - emerging: some patterns forming, partial data, hypotheses being tested
 * - established: well-understood, predictable, deviations are notable
 */
export type MaturityLevel = 'experimental' | 'emerging' | 'established';

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * A plan defines the structure and success criteria for a bounded context's activities.
 * Stored as a semantic unit with contentType 'plan'.
 */
export interface Plan {
  /** The bounded context this plan governs. */
  contextId: string;
  /** Human-readable name. */
  name: string;
  /** What this plan covers. */
  description: string;
  /** Overall maturity assessment. */
  maturity: MaturityLevel;
  /** Activity elements within this plan. */
  activities: ActivityPlan[];
  /** When this plan was created or last revised. */
  revision: number;
  /** ID of the plan revision this supersedes, if any. */
  previousRevision?: string;
}

/**
 * A planned activity — a unit of work within a context that can be
 * evaluated independently.
 */
export interface ActivityPlan {
  id: string;
  name: string;
  description: string;
  maturity: MaturityLevel;
  /** For established activities: performance baselines. */
  expectations: Expectation[];
  /** For experimental/emerging activities: testable predictions. */
  hypotheses: Hypothesis[];
  /**
   * How to structure execution to enable evaluation.
   * e.g., "Run at least 5 instances before evaluating"
   * e.g., "Compare with and without the new assembly template"
   */
  evaluationStrategy?: string;
}

// ---------------------------------------------------------------------------
// Expectations (for established activities)
// ---------------------------------------------------------------------------

export interface Expectation {
  id: string;
  /** What we're measuring. */
  metric: string;
  /** Human-readable description. */
  description: string;
  /** Comparison operator. */
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'between';
  /** Target value (or lower bound for 'between'). */
  value: number;
  /** Upper bound (only for 'between'). */
  upperValue?: number;
  /** Acceptable deviation before flagging (fraction, e.g. 0.1 = 10%). */
  tolerance: number;
}

// ---------------------------------------------------------------------------
// Hypotheses (for experimental/emerging activities)
// ---------------------------------------------------------------------------

export type HypothesisStatus =
  | 'untested'
  | 'testing'
  | 'validated'
  | 'invalidated'
  | 'inconclusive';

export interface Hypothesis {
  id: string;
  /** The prediction. e.g., "Splitting retrieval into two phases will improve score by >10%". */
  statement: string;
  /** What would validate this hypothesis. */
  validationCriteria: string;
  /** What would invalidate it. */
  invalidationCriteria?: string;
  /** Minimum number of runs/observations needed to evaluate. */
  minObservations: number;
  /** Current status. */
  status: HypothesisStatus;
  /** If validated/invalidated, the evidence. */
  evidence?: string;
}

// ---------------------------------------------------------------------------
// Evaluation (comparing execution against plan)
// ---------------------------------------------------------------------------

export interface EvaluationResult {
  planId: string;
  contextId: string;
  evaluatedAt: number;
  /** Run IDs included in this evaluation. */
  runIds: string[];
  /** Per-activity evaluations. */
  activityResults: ActivityEvaluationResult[];
  /** Overall summary. */
  summary: string;
  /** Suggested plan revisions based on the evaluation. */
  suggestedRevisions: PlanRevision[];
}

export interface ActivityEvaluationResult {
  activityId: string;
  activityName: string;
  maturity: MaturityLevel;
  /** Expectation evaluation results (for established activities). */
  expectationResults: ExpectationResult[];
  /** Hypothesis evaluation results (for experimental/emerging activities). */
  hypothesisResults: HypothesisResult[];
  /** Whether the maturity level should change based on these results. */
  suggestedMaturity?: MaturityLevel;
  /** Free-form observations. */
  observations: string[];
}

export interface ExpectationResult {
  expectationId: string;
  metric: string;
  expectedValue: number;
  actualValue: number;
  met: boolean;
  /** How far off (as fraction). Negative = below, positive = above. */
  deviation: number;
  /** Whether the deviation exceeds tolerance. */
  withinTolerance: boolean;
}

export interface HypothesisResult {
  hypothesisId: string;
  statement: string;
  previousStatus: HypothesisStatus;
  newStatus: HypothesisStatus;
  observationCount: number;
  evidence: string;
}

// ---------------------------------------------------------------------------
// Plan Revisions
// ---------------------------------------------------------------------------

export type RevisionType =
  | 'update-expectation'
  | 'add-expectation'
  | 'remove-expectation'
  | 'update-hypothesis-status'
  | 'add-hypothesis'
  | 'retire-hypothesis'
  | 'change-maturity'
  | 'restructure'
  | 'add-activity'
  | 'remove-activity';

export interface PlanRevision {
  type: RevisionType;
  activityId: string;
  description: string;
  /** The specific change. */
  detail: Record<string, unknown>;
}
