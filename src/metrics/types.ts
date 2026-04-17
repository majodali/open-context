/**
 * Metrics type definitions.
 *
 * Three layers:
 * 1. StepTelemetry — per-step, per-run structured measurements
 * 2. RunRecord + RunOutcome — per-run trace with caller-reported qualitative feedback
 * 3. ImplicitSignal — automatically detected patterns across runs
 */

import type { StepType, PipelineInput, ContentClassification } from '../core/types.js';

// ---------------------------------------------------------------------------
// Step Telemetry — emitted by every pipeline step
// ---------------------------------------------------------------------------

export interface StepTelemetry {
  stepId: string;
  stepType: StepType;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  status: 'success' | 'error' | 'skipped';
  error?: string;
  details: StepTelemetryDetails;
}

export type StepTelemetryDetails =
  | AcquireTelemetry
  | RetrieveTelemetry
  | AssembleTelemetry
  | ProcessTelemetry
  | TriageTelemetry
  | GenericTelemetry;

export interface AcquireTelemetry {
  type: 'acquire';
  chunksProduced: number;
  classificationsAssigned: ContentClassification[];
  embeddingLatencyMs: number;
  nearDuplicatesDetected: number;
}

export interface RetrieveTelemetry {
  type: 'retrieve';
  queryEmbeddingLatencyMs: number;
  candidatesScanned: number;
  candidatesAfterScopeFilter: number;
  candidatesAfterContentFilter: number;
  resultsReturned: number;
  scoreDistribution: ScoreDistribution;
  scopesSearched: ScopeMetric[];
  emptyScopes: string[];
}

export interface ScoreDistribution {
  min: number;
  max: number;
  median: number;
  mean: number;
}

export interface ScopeMetric {
  contextId: string;
  weight: number;
  unitsFound: number;
}

export interface AssembleTelemetry {
  type: 'assemble';
  tokenBudget: number;
  tokensUsed: number;
  tokenUtilization: number;
  unitsIncluded: number;
  unitsExcludedByBudget: number;
  sectionsPopulated: number;
  sectionsEmpty: number;
  unitIds: string[];
}

export interface ProcessTelemetry {
  type: 'process';
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  toolCallCount: number;
  contextSufficiency?: 'sufficient' | 'insufficient' | 'redundant' | 'unknown';
}

export interface TriageTelemetry {
  type: 'triage';
  unitsAcquiredFromResponse: number;
  unitsAcquiredFromTools: number;
  unitsAcquiredFromHints: number;
  outcomesRecorded: number;
}

export interface GenericTelemetry {
  type: 'generic';
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Run Record — one per pipeline execution
// ---------------------------------------------------------------------------

export interface RunRecord {
  runId: string;
  timestamp: number;
  input: PipelineInput;
  profile: string;
  steps: StepTelemetry[];
  totalDurationMs: number;

  // Summary
  unitsAcquired: number;
  unitsRetrieved: number;
  unitsAssembled: number;

  // Cross-references for outcome correlation
  unitIdsRetrieved: string[];
  unitIdsAssembled: string[];
  contextId: string;

  // Outcome — attached post-run via reportOutcome()
  outcome?: RunOutcome;
}

// ---------------------------------------------------------------------------
// Run Outcome — caller-reported qualified feedback
// ---------------------------------------------------------------------------

export interface RunOutcome {
  runId: string;
  reportedAt: number;
  reportedBy: string;

  // Overall assessment
  success: boolean;
  quality: number; // 0.0–1.0

  // Qualified feedback — ranked improvement suggestions
  improvements: ImprovementSuggestion[];

  // Specific unit-level feedback
  unitFeedback: UnitFeedback[];

  // Free-form detail for curation agents to reason about
  notes?: string;
}

export type ImprovementCategory =
  | 'retrieval'
  | 'scope'
  | 'chunking'
  | 'classification'
  | 'assembly'
  | 'context-structure'
  | 'missing-knowledge'
  | 'other';

export interface ImprovementSuggestion {
  rank: number;
  category: ImprovementCategory;
  description: string;
  suggestedChange?: {
    target: string;
    currentValue?: unknown;
    suggestedValue?: unknown;
  };
}

export type UnitFeedbackSignal =
  | 'helpful'
  | 'irrelevant'
  | 'redundant'
  | 'missing-context'
  | 'outdated';

export interface UnitFeedback {
  unitId: string;
  signal: UnitFeedbackSignal;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Implicit Signals — detected automatically from run patterns
// ---------------------------------------------------------------------------

export type ImplicitSignalType =
  | 'repeated-query'
  | 'score-degradation'
  | 'iteration-burst'
  | 'empty-retrieval'
  | 'budget-exhausted';

export interface ImplicitSignal {
  type: ImplicitSignalType;
  detectedAt: number;
  runIds: string[];
  contextId: string;
  severity: 'low' | 'medium' | 'high';
  detail: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Analysis Report — produced on-demand by MetricsAnalyzer
// ---------------------------------------------------------------------------

export interface AnalysisOptions {
  contextId?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  maxRuns?: number;
}

export interface AnalysisReport {
  generatedAt: number;
  runCount: number;
  period: { from: number; to: number };

  overallSuccessRate: number;
  averageQuality: number;

  contextAnalyses: ContextAnalysis[];
  stepAnalyses: StepAnalysis[];
  topIssues: Issue[];
  topSuggestions: AggregatedSuggestion[];
  implicitSignals: ImplicitSignal[];
}

export interface ContextAnalysis {
  contextId: string;
  contextName: string;
  runCount: number;
  successRate: number;
  averageQuality: number;
  averageRetrievalScore: number;
  tokenUtilization: number;
  commonIssues: Issue[];
}

export interface StepAnalysis {
  stepType: StepType;
  averageDurationMs: number;
  errorRate: number;
  details: Record<string, number>;
}

export interface Issue {
  category: string;
  description: string;
  frequency: number;
  severity: 'low' | 'medium' | 'high';
  affectedContexts: string[];
}

export interface AggregatedSuggestion {
  category: ImprovementCategory;
  description: string;
  frequency: number;
  averageRank: number;
}

export interface RunComparison {
  runA: RunRecord;
  runB: RunRecord;
  scoreChange: number;
  durationChange: number;
  unitsOverlap: number;
  unitsOnlyInA: string[];
  unitsOnlyInB: string[];
  qualityChange?: number;
}
