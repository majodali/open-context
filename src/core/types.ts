/**
 * Core type definitions for OpenContext.
 *
 * These types define the foundational data model: semantic units (atomic knowledge elements),
 * bounded contexts (hierarchy nodes), pipeline steps, and supporting types.
 */

// ---------------------------------------------------------------------------
// Semantic Units
// ---------------------------------------------------------------------------

/** The atomic knowledge element — a single statement, rule, fact, etc. */
export interface SemanticUnit {
  id: string;
  content: string;
  embedding?: number[];
  metadata: UnitMetadata;
  contextId: string;
  usage: UsageStats;
}

export type SourceType = 'user' | 'agent' | 'document' | 'tool' | 'system';

export type ContentType =
  | 'statement'
  | 'rule'
  | 'instruction'
  | 'fact'
  | 'observation'
  | 'decision'
  | 'configuration'
  | 'role-definition'
  | 'proposal'
  | 'insight'
  | 'plan'
  | 'hypothesis'
  | 'expectation'
  | 'learning'
  | 'domain-entity'
  | 'domain-resource'
  | 'domain-relationship'
  | 'action-definition'
  | 'objective'
  | 'plan-dag';

export type Mutability = 'assertion' | 'record';

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied';

export interface UnitMetadata {
  source: string;
  sourceType: SourceType;
  contentType: ContentType;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  /** If this unit was chunked from larger content, the parent chunk's ID. */
  chunkParentId?: string;
  /** ID of the unit this one supersedes (for versioning). */
  supersedes?: string;

  // -- Governance --

  /** Agent or role ID that created this unit. */
  createdBy?: string;
  /**
   * Whether this unit is revisable knowledge ('assertion') or immutable
   * structured data ('record'). Records cannot be superseded — they are
   * evidence, not beliefs. Defaults to 'assertion'.
   */
  mutability?: Mutability;
  /**
   * For proposal units: the context ID this proposal targets.
   * The proposing agent writes the proposal into its own context;
   * the agent responsible for the target context retrieves and evaluates it.
   */
  proposalTarget?: string;
  /** For proposal units: current status of the proposal. */
  proposalStatus?: ProposalStatus;
}

export interface UsageStats {
  retrievalCount: number;
  inclusionCount: number;
  lastRetrievedAt?: number;
  lastIncludedAt?: number;
  outcomeSignals: OutcomeSignal[];
}

export interface OutcomeSignal {
  timestamp: number;
  type: 'positive' | 'negative' | 'neutral';
  source: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Bounded Context Hierarchy
// ---------------------------------------------------------------------------

/**
 * Write rules that govern which agents can modify knowledge within this context.
 * Write access is strictly scoped — an agent can only write to the context
 * it is assigned to, not to parent, child, or sibling contexts.
 * Cross-context modifications happen via proposals.
 */
export interface WriteRules {
  /** Agent/role IDs that can write to this context. Empty array = unrestricted. */
  writers: string[];
  /** Content types that can be created in this context. Undefined = all allowed. */
  allowedContentTypes?: ContentType[];
}

export const DEFAULT_WRITE_RULES: WriteRules = {
  writers: [],
};

/** A node in the hierarchical work breakdown structure. */
export interface BoundedContext {
  id: string;
  name: string;
  description: string;
  parentId?: string;
  childIds: string[];
  scopeRules: ScopeRules;
  writeRules: WriteRules;
  metadata: Record<string, unknown>;
}

/**
 * Weighted scope rules that determine how queries traverse the hierarchy.
 * Weights are 0.0–1.0 and serve as multipliers on similarity scores.
 * `depthDecay` is applied per level of distance; `minWeight` ensures
 * nothing is ever fully invisible.
 */
export interface ScopeRules {
  selfWeight: number;
  parentWeight: number;
  siblingWeight: number;
  childWeight: number;
  depthDecay: number;
  minWeight: number;
  inheritRules: boolean;
}

export const DEFAULT_SCOPE_RULES: ScopeRules = {
  selfWeight: 1.0,
  parentWeight: 0.8,
  siblingWeight: 0.5,
  childWeight: 0.9,
  depthDecay: 0.7,
  minWeight: 0.1,
  inheritRules: true,
};

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export type StepType =
  | 'acquire'
  | 'index'
  | 'retrieve'
  | 'assemble'
  | 'process'
  | 'triage'
  | 'curate';

export type AutomationTier = 'local' | 'async' | 'llm' | 'multi-step' | 'human';

export interface StepConfig {
  id: string;
  type: StepType;
  handler: StepHandler;
  automationTier: AutomationTier;
  params: Record<string, unknown>;
  enabled: boolean;
}

/**
 * A step handler receives the shared pipeline context and returns it
 * (possibly mutated). Steps communicate via PipelineContext.
 */
export type StepHandler = (ctx: PipelineContext) => Promise<PipelineContext>;

export interface PipelineProfile {
  name: string;
  steps: string[];
  description: string;
}

export interface PipelineConfig {
  steps: StepConfig[];
  profiles: PipelineProfile[];
  defaultProfile: string;
}

/**
 * Mutable context object that flows through the pipeline.
 * Each step reads from and writes to this object.
 */
export interface PipelineContext {
  /** The original input to the pipeline. */
  input: PipelineInput;
  /** Accumulated results from each step, keyed by step ID. */
  stepResults: Record<string, unknown>;
  /** Units acquired during this cycle. */
  acquiredUnits: SemanticUnit[];
  /** Units retrieved for the current query. */
  retrievedUnits: ScoredUnit[];
  /** Assembled input ready for the agent. */
  assembledInput?: AssembledInput;
  /** Agent output (after processing step). */
  agentOutput?: AgentOutput;
  /** Metadata accumulated across steps. */
  meta: Record<string, unknown>;
}

export interface PipelineInput {
  query?: string;
  content?: string;
  contextId: string;
  taskType?: string;
  profile?: string;
  params?: Record<string, unknown>;
}

export interface PipelineOutput {
  agentOutput?: AgentOutput;
  acquiredUnits: SemanticUnit[];
  retrievedUnits: ScoredUnit[];
  meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export interface ScopedContext {
  contextId: string;
  weight: number;
  relationship:
    | 'self'
    | 'parent'
    | 'ancestor'
    | 'child'
    | 'descendant'
    | 'sibling';
  depth: number;
}

export interface RetrievalOptions {
  contextId: string;
  maxResults: number;
  minSimilarity?: number;
  contentTypes?: ContentType[];
  tags?: string[];
  includeUsageStats?: boolean;
}

export interface ScoredUnit {
  unit: SemanticUnit;
  score: number;
  scopeWeight: number;
  vectorSimilarity: number;
}

export interface RetrievalResult {
  units: ScoredUnit[];
  query: string;
  contextId: string;
  scopesSearched: ScopedContext[];
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface TemplateSection {
  name: string;
  contentTypes?: ContentType[];
  tags?: string[];
  maxUnits?: number;
  prefix?: string;
  suffix?: string;
}

export interface AssemblyTemplate {
  id: string;
  sections: TemplateSection[];
  maxTokens?: number;
  prioritization: 'recency' | 'relevance' | 'usage' | 'custom';
}

export interface AssembledInput {
  sections: { name: string; content: string }[];
  totalUnits: number;
  totalTokensEstimate: number;
  template: AssemblyTemplate;
}

// ---------------------------------------------------------------------------
// Agent Adapter
// ---------------------------------------------------------------------------

export interface AgentOutput {
  response: string;
  toolCalls?: ToolCall[];
  metadata?: Record<string, unknown>;
  /** Knowledge acquisition hints from the agent. */
  acquireHints?: AcquireHint[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

export interface AcquireHint {
  content: string;
  contentType: ContentType;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

export interface ChunkOptions {
  maxChunkSize: number;
  preserveContext: boolean;
  contentType?: string;
  /**
   * If true, the entire content is returned as a single chunk verbatim
   * (no splitting, no whitespace normalization). Use for structured content
   * like JSON where exact formatting must be preserved.
   */
  noChunking?: boolean;
}

export interface ChunkResult {
  content: string;
  index: number;
  parentContent?: string;
}

export interface ContentClassification {
  contentType: ContentType;
  tags: string[];
  confidence: number;
}

export interface AcquireOptions {
  sourceType?: SourceType;
  contentType?: ContentType;
  tags?: string[];
  chunkOptions?: Partial<ChunkOptions>;
  /** Agent/role ID performing the acquisition. Used for write rule enforcement. */
  createdBy?: string;
  /** Mutability of the acquired units. Defaults to 'assertion'. */
  mutability?: Mutability;
}

// ---------------------------------------------------------------------------
// Vector Store
// ---------------------------------------------------------------------------

export interface SearchResult {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export type FilterFn = (id: string, metadata?: Record<string, unknown>) => boolean;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface PersistenceData {
  version: string;
  units: SemanticUnit[];
  contexts: BoundedContext[];
  pipelineConfig: PipelineConfig;
  metadata: Record<string, unknown>;
}
