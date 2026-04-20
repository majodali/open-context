/**
 * Walkthrough types.
 *
 * A walkthrough is a reproducible end-to-end exercise:
 *   scenario + corpus + instrumentation + real or scripted agent → captured result for review
 *
 * Scenarios are the reusable unit. A scenario pairs one or more objectives
 * with the corpus they run against, the agent configuration, and the
 * observability choices.
 *
 * Results are structured and suitable for both programmatic analysis
 * and human review. They include tiered pass/fail criteria:
 * - produced output
 * - basic validation (no errors, outputs match schemas)
 * - self-reported validation (agent said context was sufficient)
 * - external review (human or capable agent — filled in post-run)
 */

import type {
  BenchmarkCorpus,
  BenchmarkContext,
} from '../benchmark/types.js';
import type { Objective } from '../execution/plan-dag.js';
import type { OrchestrationResult } from '../execution/orchestrator.js';
import type { ExecutionEvent } from '../execution/events.js';
import type { FeedbackRecord } from '../execution/feedback.js';
import type { TrainingExample } from '../retrieval/training-data.js';
import type { AgentAdapter } from '../processing/agent-adapter.js';
import type { ContentType } from '../core/types.js';

// ---------------------------------------------------------------------------
// Scenario spec
// ---------------------------------------------------------------------------

/**
 * Additional unit that can be seeded alongside a corpus (e.g., scenario-specific
 * knowledge not in the shared corpus).
 */
export interface AdditionalUnit {
  /** Context ID (must match a BenchmarkContext.id in the corpus). */
  contextId: string;
  content: string;
  contentType: ContentType;
  tags: string[];
}

/**
 * Extra contexts to create beyond those in the corpus (scenario-specific hierarchy).
 */
export interface AdditionalContext extends BenchmarkContext {}

/**
 * Agent configuration options for a walkthrough.
 * The walkthrough runner builds the adapter based on these options, or accepts
 * a custom adapter instance if more control is needed.
 */
export type WalkthroughAgent =
  | { type: 'anthropic'; model: string; maxTokens?: number; temperature?: number; apiKey?: string }
  | { type: 'noop' }
  | { type: 'custom'; adapter: AgentAdapter };

export interface WalkthroughExecutionConfig {
  /** The agent used for all actions. */
  agent: WalkthroughAgent;
  /** Maximum tokens for assembled context per action. Default: 8000 */
  maxContextTokens?: number;
  /** Maximum tool call rounds per action. Default: 10 */
  maxToolCallRounds?: number;
  /**
   * Whether to register the standard knowledge tools (get_unit_detail,
   * query_knowledge) so the agent can explore beyond the initial context.
   * Default: true
   */
  useStandardTools?: boolean;
  /**
   * Whether to enable the feedback-to-training bridge so every feedback
   * becomes training data. Default: true
   */
  recordTrainingData?: boolean;
  /** System prompt prepended to every agent invocation. */
  systemPrompt?: string;
}

/**
 * Optional tier expectations — if set, the runner records pass/fail for each.
 * A tier is "expected to pass" by default; setting expectations allows
 * scenarios to document what they consider acceptable.
 */
export interface WalkthroughExpectations {
  /** Expected: produces output. Default: true */
  expectOutput?: boolean;
  /** Expected: basic validation passes (no errors, schemas satisfied). Default: true */
  expectBasicValidation?: boolean;
  /**
   * Expected: agent self-report is at least this level of sufficiency.
   * Default: 'mostly-sufficient' (or 'sufficient' if strict).
   */
  minSelfReportedSufficiency?: 'sufficient' | 'mostly-sufficient';
}

export interface WalkthroughScenario {
  id: string;
  name: string;
  description: string;

  // ── Setup ──
  /** The shared corpus this scenario runs against. */
  corpus: BenchmarkCorpus;
  /** Extra contexts to create (beyond those in the corpus). */
  additionalContexts?: AdditionalContext[];
  /** Extra units to seed (beyond those in the corpus). */
  additionalUnits?: AdditionalUnit[];
  /** Whether to seed the OpenContext meta-actions. Default: true */
  seedMetaActions?: boolean;

  // ── The work ──
  /**
   * Objectives to orchestrate. Each runs through the full meta-plan
   * (classify → clarify → search → select → execute → incorporate).
   * contextId on each objective must match a BenchmarkContext.id in the corpus.
   */
  objectives: Objective[];

  /**
   * Scripted responses to user-input tool calls, in order.
   * If the agent asks for more input than scripted, the handler throws.
   */
  scriptedUserResponses?: string[];

  // ── Configuration ──
  execution: WalkthroughExecutionConfig;

  // ── Success criteria ──
  expectations?: WalkthroughExpectations;
}

// ---------------------------------------------------------------------------
// Walkthrough result
// ---------------------------------------------------------------------------

/**
 * Self-reported sufficiency — the best across all feedback records in the run.
 * null means no feedback was collected.
 */
export type SelfReportedSufficiency =
  | 'sufficient'
  | 'mostly-sufficient'
  | 'insufficient'
  | 'excessive'
  | null;

/**
 * Tier-by-tier pass status. Each can be pending (not yet evaluated).
 */
export interface WalkthroughTierResults {
  /** Tier 1: Did the run produce any output at all? */
  producedOutput: boolean;
  /** Tier 2: Were outputs well-formed with validations passing? */
  basicValidation: boolean;
  /** Tier 3: What's the best self-reported sufficiency across feedbacks? */
  selfReportedSufficiency: SelfReportedSufficiency;
  /** Tier 4: External review — filled in after the run by a reviewer. */
  externalReview?: ExternalReviewResult;
  /** Overall pass per expected tiers (computed against scenario.expectations). */
  passedExpectations: boolean;
}

/**
 * External review — provided by a human or a capable reviewer agent after the run.
 */
export interface ExternalReviewResult {
  reviewedBy: string; // 'human:<name>' or 'agent:<model>'
  reviewedAt: number;

  /** Overall verdict. */
  overall: 'excellent' | 'good' | 'acceptable' | 'poor' | 'failed';

  /** Qualitative assessment of the agent's output(s). */
  outputQuality: {
    assessment: 'excellent' | 'good' | 'acceptable' | 'poor' | 'failed';
    notes: string;
  };

  /** Retrieval quality review: which units were valuable, missed, or noise. */
  retrievalQuality?: {
    /** Units that were valuable AND retrieved. */
    valuableRetrieved: string[]; // unit IDs
    /** Units that were valuable but NOT retrieved (retrieval gap). */
    valuableMissed: string[];
    /** Units that were retrieved but NOT valuable (retrieval noise). */
    nonValuableRetrieved: string[];
    /** Tag suggestions: tags that might have improved retrieval. */
    tagSuggestions: TagSuggestion[];
    notes: string;
  };

  /** Process observations. */
  processObservations?: string[];

  /** Raw notes for future analysis. */
  rawNotes?: string;
}

export interface TagSuggestion {
  /** The suggested tag (ideally namespaced: e.g., 'applies-to:User'). */
  tag: string;
  /** Which units should receive this tag. */
  applyTo: string[]; // unit IDs
  /** Why — rationale for the tag. */
  rationale: string;
}

/**
 * The captured result of one walkthrough run.
 * Contains everything needed for review and post-run analysis.
 */
export interface WalkthroughResult {
  scenario: {
    id: string;
    name: string;
    description: string;
  };

  /** When the run started and finished. */
  startedAt: number;
  completedAt: number;
  durationMs: number;

  /**
   * Orchestration result(s) — one per objective.
   * Contains the full meta-plan DAG with all attempts, outputs, validations.
   */
  orchestrations: OrchestrationResult[];

  // ── Observations ──

  /** Live event stream captured during execution. */
  events: ExecutionEvent[];
  /** Feedback records from every agent invocation. */
  feedbackRecords: FeedbackRecord[];
  /** Training examples generated from feedback. */
  trainingExamples: TrainingExample[];

  // ── Tier results ──
  tiers: WalkthroughTierResults;

  // ── Stats for quick summary ──
  stats: WalkthroughStats;
}

export interface WalkthroughStats {
  totalObjectives: number;
  totalActions: number;
  totalAttempts: number;
  failedAttempts: number;
  totalTokens: number; // Sum of input + output tokens across all agent calls
  totalToolCalls: number;
  unitsInCorpus: number;
  contextsInCorpus: number;
}
