/**
 * OpenContext — Knowledge lifecycle management system for AI agents.
 *
 * @module @opencontext/core
 */

import { v4 as uuidv4 } from 'uuid';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

// Core
export * from './core/types.js';
export { Pipeline } from './core/pipeline.js';

// Storage
export { type VectorStore, InMemoryVectorStore } from './storage/vector-store.js';
export { type Embedder, NoopEmbedder, DeterministicEmbedder, OpenAIEmbedder } from './storage/embedder.js';
export { TransformersEmbedder, type TransformersEmbedderConfig } from './storage/transformers-embedder.js';
export { type ContextStore, InMemoryContextStore } from './storage/context-store.js';
export { type UnitStore, InMemoryUnitStore } from './storage/unit-store.js';

// Acquisition
export { type Chunker, DefaultChunker } from './acquisition/chunker.js';
export { type Classifier, RuleBasedClassifier } from './acquisition/classifier.js';
export { acquireContent, createAcquireStep } from './acquisition/acquire.js';

// Retrieval
export { type ScopeResolver, DefaultScopeResolver } from './retrieval/scope-resolver.js';
export { type Retriever, VectorRetriever, createRetrieveStep } from './retrieval/retriever.js';

// Assembly
export { type Assembler, DefaultAssembler, DEFAULT_TEMPLATE, createAssembleStep } from './assembly/assembler.js';

// Processing
export { type AgentAdapter, NoopAgentAdapter, createProcessStep } from './processing/agent-adapter.js';
export { AnthropicAgentAdapter, type AnthropicAdapterConfig } from './processing/anthropic-adapter.js';
export { createTriageStep, type TriageConfig } from './processing/triage.js';

// Curation
export { UsageTracker, type UsageReport, type UsageTrackerConfig } from './curation/usage-tracker.js';

// Metrics
export * from './metrics/types.js';
export { type MetricsStore, InMemoryMetricsStore, type MetricsData } from './metrics/metrics-store.js';
export { MetricsCollector } from './metrics/collector.js';
export { ImplicitSignalDetector, type ImplicitSignalConfig } from './metrics/implicit-signals.js';
export { MetricsAnalyzer } from './metrics/analyzer.js';
export { InsightBridge, type InsightBridgeConfig } from './metrics/insight-bridge.js';

// Config & Governance
export { ConfigResolver, type ConfigEntry } from './core/config-resolver.js';
export { WriteAccessError, checkWriteAccess } from './acquisition/acquire.js';
export { OPENCONTEXT_SEED, getSeedAcquireOptions, type SeedUnit } from './core/seed-content.js';

// Planning & Learning
export * from './planning/types.js';
export { PlanManager } from './planning/plan-manager.js';

// Execution: Domain, Action, and DAG models
export * from './execution/domain-model.js';
export * from './execution/action-model.js';
export * from './execution/plan-dag.js';
export { DAGEngine, type ActionExecutor, type DAGValidationError } from './execution/dag-engine.js';
export {
  QueryConstructor,
  type QueryConstructorConfig,
  type ConstructedQuery,
  type RetrievalRequest,
  type QueryResult,
} from './execution/query-constructor.js';
export {
  type ExecutionFeedback,
  type UnitUsageFeedback,
  type UnusedUnitFeedback,
  type MissingInfo,
  type AdditionalQueryFeedback,
  type ActionDefinitionFeedback,
  type FeedbackRecord,
  type FeedbackStore,
  InMemoryFeedbackStore,
  parseFeedback,
  extractPrimaryResponse,
  FEEDBACK_INSTRUCTIONS,
} from './execution/feedback.js';
export {
  AgentActionExecutor,
  type AgentExecutorConfig,
} from './execution/agent-executor.js';

// Internal imports for OpenContext class
import type {
  BoundedContext,
  SemanticUnit,
  AcquireOptions,
  RetrievalOptions,
  RetrievalResult,
  PipelineInput,
  PipelineOutput,
  PipelineConfig,
  ScopeRules,
  WriteRules,
  PersistenceData,
} from './core/types.js';
import { Pipeline } from './core/pipeline.js';
import { InMemoryVectorStore } from './storage/vector-store.js';
import type { VectorStore } from './storage/vector-store.js';
import type { Embedder } from './storage/embedder.js';
import { NoopEmbedder } from './storage/embedder.js';
import { InMemoryContextStore } from './storage/context-store.js';
import type { ContextStore } from './storage/context-store.js';
import { InMemoryUnitStore } from './storage/unit-store.js';
import type { UnitStore } from './storage/unit-store.js';
import { DefaultChunker } from './acquisition/chunker.js';
import type { Chunker } from './acquisition/chunker.js';
import { RuleBasedClassifier } from './acquisition/classifier.js';
import type { Classifier } from './acquisition/classifier.js';
import { acquireContent, createAcquireStep, type AcquisitionDeps } from './acquisition/acquire.js';
import { DefaultScopeResolver } from './retrieval/scope-resolver.js';
import type { ScopeResolver } from './retrieval/scope-resolver.js';
import { VectorRetriever, createRetrieveStep } from './retrieval/retriever.js';
import { DefaultAssembler, DEFAULT_TEMPLATE, createAssembleStep } from './assembly/assembler.js';
import type { AgentAdapter } from './processing/agent-adapter.js';
import { NoopAgentAdapter, createProcessStep } from './processing/agent-adapter.js';
import { createTriageStep } from './processing/triage.js';

// Metrics imports
import type { MetricsStore } from './metrics/metrics-store.js';
import { InMemoryMetricsStore } from './metrics/metrics-store.js';
import { MetricsCollector } from './metrics/collector.js';
import { ImplicitSignalDetector } from './metrics/implicit-signals.js';
import type { ImplicitSignalConfig } from './metrics/implicit-signals.js';
import { MetricsAnalyzer } from './metrics/analyzer.js';
import type {
  RunOutcome,
  AnalysisOptions,
  AnalysisReport,
  ImplicitSignal,
} from './metrics/types.js';
import { InsightBridge } from './metrics/insight-bridge.js';
import type { InsightBridgeConfig } from './metrics/insight-bridge.js';
import { ConfigResolver } from './core/config-resolver.js';
import { OPENCONTEXT_SEED, getSeedAcquireOptions } from './core/seed-content.js';
import { PlanManager } from './planning/plan-manager.js';
import type { Plan, EvaluationResult, PlanRevision } from './planning/types.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OpenContextConfig {
  embedder?: Embedder;
  vectorStore?: VectorStore;
  contextStore?: ContextStore;
  unitStore?: UnitStore;
  chunker?: Chunker;
  classifier?: Classifier;
  scopeResolver?: ScopeResolver;
  agentAdapter?: AgentAdapter;
  pipelineConfig?: Partial<PipelineConfig>;
  defaultScopeRules?: ScopeRules;
  metricsStore?: MetricsStore;
  implicitSignalConfig?: Partial<ImplicitSignalConfig>;
  insightBridgeConfig?: Partial<InsightBridgeConfig>;
  /** If true, acquire seed content into the root context on initialization. */
  seedOnInit?: boolean;
}

// ---------------------------------------------------------------------------
// Main Class
// ---------------------------------------------------------------------------

const DEFAULT_SCOPE: ScopeRules = {
  selfWeight: 1.0,
  parentWeight: 0.8,
  siblingWeight: 0.5,
  childWeight: 0.9,
  depthDecay: 0.7,
  minWeight: 0.1,
  inheritRules: true,
};

export class OpenContext {
  // Stores
  readonly vectorStore: VectorStore;
  readonly contextStore: ContextStore;
  readonly unitStore: UnitStore;

  // Components
  readonly embedder: Embedder;
  readonly chunker: Chunker;
  readonly classifier: Classifier;
  readonly scopeResolver: ScopeResolver;
  readonly agentAdapter: AgentAdapter;

  // Pipeline
  readonly pipeline: Pipeline;

  // Metrics
  readonly metricsStore: MetricsStore;
  readonly metricsCollector: MetricsCollector;
  readonly metricsAnalyzer: MetricsAnalyzer;
  readonly implicitSignalDetector: ImplicitSignalDetector;
  readonly insightBridge: InsightBridge;

  // Config & governance
  readonly configResolver: ConfigResolver;

  // Planning & learning
  readonly planManager: PlanManager;

  private defaultScopeRules: ScopeRules;
  private seedOnInit: boolean;

  constructor(config?: OpenContextConfig) {
    // Initialize components with defaults
    this.embedder = config?.embedder ?? new NoopEmbedder();
    this.vectorStore = config?.vectorStore ?? new InMemoryVectorStore();
    this.contextStore = config?.contextStore ?? new InMemoryContextStore();
    this.unitStore = config?.unitStore ?? new InMemoryUnitStore();
    this.chunker = config?.chunker ?? new DefaultChunker();
    this.classifier = config?.classifier ?? new RuleBasedClassifier();
    this.scopeResolver = config?.scopeResolver ?? new DefaultScopeResolver();
    this.agentAdapter = config?.agentAdapter ?? new NoopAgentAdapter();
    this.defaultScopeRules = config?.defaultScopeRules ?? DEFAULT_SCOPE;

    // Initialize metrics
    this.metricsStore = config?.metricsStore ?? new InMemoryMetricsStore();
    this.metricsCollector = new MetricsCollector(this.metricsStore);
    this.implicitSignalDetector = new ImplicitSignalDetector(config?.implicitSignalConfig);
    this.metricsAnalyzer = new MetricsAnalyzer(
      this.metricsStore,
      this.unitStore,
      this.contextStore,
      this.implicitSignalDetector,
    );
    this.insightBridge = new InsightBridge(config?.insightBridgeConfig);

    // Config resolver
    this.configResolver = new ConfigResolver(this.unitStore);

    // Planning & learning
    this.planManager = new PlanManager(this.unitStore, this.metricsStore);

    // Build pipeline with default steps and instrument for metrics
    this.pipeline = this.buildDefaultPipeline(config?.pipelineConfig);
    this.metricsCollector.instrumentPipeline(this.pipeline);

    this.seedOnInit = config?.seedOnInit ?? false;
  }

  // -- Knowledge Management --

  async acquire(
    content: string,
    contextId: string,
    options?: AcquireOptions,
  ): Promise<SemanticUnit[]> {
    return acquireContent(content, contextId, this.getAcquisitionDeps(), options);
  }

  // -- Context Hierarchy --

  async createContext(
    context: Omit<BoundedContext, 'id' | 'childIds' | 'scopeRules' | 'writeRules'> & {
      id?: string;
      childIds?: string[];
      scopeRules?: Partial<ScopeRules>;
      writeRules?: Partial<WriteRules>;
    },
  ): Promise<BoundedContext> {
    const full: BoundedContext = {
      id: context.id ?? uuidv4(),
      name: context.name,
      description: context.description,
      parentId: context.parentId,
      childIds: context.childIds ?? [],
      scopeRules: { ...this.defaultScopeRules, ...context.scopeRules },
      writeRules: { writers: [], ...context.writeRules },
      metadata: context.metadata ?? {},
    };
    await this.contextStore.createContext(full);
    return full;
  }

  async getContext(id: string): Promise<BoundedContext | null> {
    return this.contextStore.getContext(id);
  }

  // -- Retrieval --

  async retrieve(
    query: string,
    contextId: string,
    options?: Partial<RetrievalOptions>,
  ): Promise<RetrievalResult> {
    const retriever = new VectorRetriever({
      embedder: this.embedder,
      vectorStore: this.vectorStore,
      unitStore: this.unitStore,
      contextStore: this.contextStore,
      scopeResolver: this.scopeResolver,
    });
    return retriever.retrieve(query, {
      contextId,
      maxResults: 20,
      ...options,
    });
  }

  // -- Full Pipeline (instrumented with metrics) --

  async run(input: PipelineInput): Promise<PipelineOutput & { runId: string }> {
    return this.metricsCollector.instrumentedRun(this.pipeline, input, input.profile);
  }

  // -- Metrics --

  /**
   * Report an outcome against a previous pipeline run.
   * Outcomes carry qualified feedback: success/failure, quality score,
   * ranked improvement suggestions, and unit-level feedback.
   */
  async reportOutcome(outcome: RunOutcome): Promise<void> {
    await this.metricsCollector.reportOutcome(outcome);
  }

  /**
   * Run on-demand metrics analysis.
   * Returns a structured report with per-context and per-step breakdowns,
   * top issues, aggregated improvement suggestions, and implicit signals.
   */
  async analyzeMetrics(options?: AnalysisOptions): Promise<AnalysisReport> {
    return this.metricsAnalyzer.analyze(options);
  }

  /**
   * Detect implicit signals from run history.
   * Looks for repeated queries, score degradation, iteration bursts,
   * empty retrievals, and budget exhaustion.
   */
  async detectSignals(): Promise<ImplicitSignal[]> {
    return this.implicitSignalDetector.detect(this.metricsStore);
  }

  // -- Seed Content --

  /**
   * Acquire seed content into a context. This teaches the agent how
   * the OpenContext system works. Typically called once on the root context.
   */
  async seed(contextId: string): Promise<SemanticUnit[]> {
    const allUnits: SemanticUnit[] = [];
    for (const seedUnit of OPENCONTEXT_SEED) {
      const units = await this.acquire(
        seedUnit.content,
        contextId,
        getSeedAcquireOptions(seedUnit),
      );
      allUnits.push(...units);
    }
    return allUnits;
  }

  // -- Insights --

  /**
   * Run metrics analysis and convert findings into semantic units
   * stored in the specified context (or root).
   * Returns both the report and the acquired insight units.
   */
  async generateInsights(
    contextId: string,
    analysisOptions?: AnalysisOptions,
  ): Promise<{ report: AnalysisReport; insights: SemanticUnit[] }> {
    const report = await this.analyzeMetrics(analysisOptions);
    const insights = await this.insightBridge.processReport(
      report,
      this.getAcquisitionDeps(),
    );
    return { report, insights };
  }

  // -- Configuration as Knowledge --

  /**
   * Get a configuration value from the knowledge base, resolving
   * hierarchically from root to the specified context.
   */
  async getConfig(contextId: string, key: string): Promise<unknown | undefined> {
    const configs = await this.configResolver.resolveHierarchical(
      contextId,
      this.contextStore,
    );
    return configs.get(key);
  }

  /**
   * Set a configuration value by acquiring it as a configuration unit.
   * If a previous config with the same key exists, the new one supersedes it.
   */
  async setConfig(
    contextId: string,
    key: string,
    value: unknown,
    agentId?: string,
  ): Promise<SemanticUnit[]> {
    // Find existing config to supersede
    const existing = await this.configResolver.getConfig(contextId, key);
    const content = `${key}: ${JSON.stringify(value)}`;

    return this.acquire(content, contextId, {
      sourceType: 'system',
      contentType: 'configuration',
      tags: [`config:${key}`],
      createdBy: agentId,
    });
  }

  // -- Proposals --

  /**
   * Create a proposal to modify knowledge in another context.
   * The proposal is written into the proposing agent's own context.
   * The agent responsible for the target context can retrieve and evaluate it.
   */
  async createProposal(
    fromContextId: string,
    targetContextId: string,
    description: string,
    agentId?: string,
  ): Promise<SemanticUnit[]> {
    return this.acquire(description, fromContextId, {
      sourceType: 'agent',
      contentType: 'proposal',
      tags: [`proposal-target:${targetContextId}`, 'status:pending'],
      createdBy: agentId,
    });
  }

  /**
   * Retrieve pending proposals targeting a specific context.
   * Searches all child contexts for proposal units.
   */
  async getPendingProposals(targetContextId: string): Promise<SemanticUnit[]> {
    const allUnits = await this.unitStore.getAll();
    return allUnits.filter(
      (u) =>
        u.metadata.contentType === 'proposal' &&
        u.metadata.proposalTarget === targetContextId &&
        u.metadata.proposalStatus === 'pending',
    ).concat(
      // Also find proposals using the tag-based approach
      allUnits.filter(
        (u) =>
          u.metadata.contentType === 'proposal' &&
          u.metadata.tags.includes(`proposal-target:${targetContextId}`) &&
          (u.metadata.proposalStatus === 'pending' || u.metadata.tags.includes('status:pending')),
      ),
    ).filter((u, i, arr) => arr.findIndex((x) => x.id === u.id) === i); // dedupe
  }

  /**
   * Update the status of a proposal unit.
   */
  async resolveProposal(
    unitId: string,
    status: 'approved' | 'rejected' | 'applied',
  ): Promise<void> {
    const unit = await this.unitStore.get(unitId);
    if (!unit) throw new Error(`Unit '${unitId}' not found`);
    if (unit.metadata.contentType !== 'proposal') {
      throw new Error(`Unit '${unitId}' is not a proposal`);
    }
    await this.unitStore.update(unitId, {
      metadata: {
        ...unit.metadata,
        proposalStatus: status,
        tags: unit.metadata.tags
          .filter((t) => !t.startsWith('status:'))
          .concat([`status:${status}`]),
        updatedAt: Date.now(),
      },
    });
  }

  // -- Planning & Learning --

  /**
   * Create a plan for a bounded context.
   * Plans define activities with expectations (for mature work)
   * and hypotheses (for experimental work).
   */
  async createPlan(plan: Plan): Promise<SemanticUnit[]> {
    return this.planManager.createPlan(plan, this.getAcquisitionDeps());
  }

  /**
   * Get the current plan for a context.
   */
  async getPlan(contextId: string): Promise<Plan | null> {
    return this.planManager.getPlan(contextId);
  }

  /**
   * Evaluate recent execution against the plan for a context.
   * Produces structured learnings: which expectations were met,
   * which hypotheses have data, and suggested plan revisions.
   */
  async evaluate(
    contextId: string,
    options?: { maxRuns?: number; sinceTimestamp?: number },
  ): Promise<EvaluationResult | null> {
    return this.planManager.evaluate(contextId, options);
  }

  /**
   * Evaluate and store the results as learning units.
   * Returns both the evaluation and the acquired learning units.
   */
  async evaluateAndLearn(
    contextId: string,
    options?: { maxRuns?: number; sinceTimestamp?: number },
  ): Promise<{ evaluation: EvaluationResult; learnings: SemanticUnit[] } | null> {
    const evaluation = await this.evaluate(contextId, options);
    if (!evaluation) return null;

    const learnings = await this.planManager.storeLearning(
      evaluation,
      this.getAcquisitionDeps(),
    );
    return { evaluation, learnings };
  }

  /**
   * Revise a plan based on evaluation results or manual revisions.
   * The old plan is superseded; the new version is stored.
   */
  async revisePlan(
    contextId: string,
    revisions: PlanRevision[],
  ): Promise<SemanticUnit[] | null> {
    return this.planManager.revisePlan(contextId, revisions, this.getAcquisitionDeps());
  }

  // -- Persistence --

  async save(path: string): Promise<void> {
    const metricsData = await this.metricsStore.exportAll();

    const data: PersistenceData = {
      version: '0.1.0',
      units: await this.unitStore.getAll(),
      contexts: await this.contextStore.getAll(),
      pipelineConfig: {
        steps: [],
        profiles: this.pipeline.listProfiles(),
        defaultProfile: 'full',
      },
      metadata: {
        metrics: metricsData,
      },
    };

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
  }

  async load(path: string): Promise<void> {
    const raw = await readFile(path, 'utf-8');
    const data: PersistenceData = JSON.parse(raw);

    // Clear existing data
    await this.unitStore.clear();
    await this.contextStore.clear();
    await this.vectorStore.clear();
    await this.metricsStore.clear();

    // Restore contexts
    for (const ctx of data.contexts) {
      await this.contextStore.createContext(ctx);
    }

    // Restore units (re-index in vector store)
    for (const unit of data.units) {
      await this.unitStore.add(unit);
      if (unit.embedding) {
        await this.vectorStore.add(unit.id, unit.embedding, {
          contextId: unit.contextId,
        });
      }
    }

    // Restore metrics if present
    if (data.metadata?.['metrics']) {
      await this.metricsStore.importAll(data.metadata['metrics'] as any);
    }
  }

  // -- Private --

  private getAcquisitionDeps(): AcquisitionDeps {
    return {
      chunker: this.chunker,
      classifier: this.classifier,
      embedder: this.embedder,
      vectorStore: this.vectorStore,
      unitStore: this.unitStore,
      contextStore: this.contextStore,
    };
  }

  private buildDefaultPipeline(config?: Partial<PipelineConfig>): Pipeline {
    const acquisitionDeps = {
      chunker: this.chunker,
      classifier: this.classifier,
      embedder: this.embedder,
      vectorStore: this.vectorStore,
      unitStore: this.unitStore,
      contextStore: this.contextStore,
    };

    const retriever = new VectorRetriever({
      embedder: this.embedder,
      vectorStore: this.vectorStore,
      unitStore: this.unitStore,
      contextStore: this.contextStore,
      scopeResolver: this.scopeResolver,
    });

    const assembler = new DefaultAssembler({ unitStore: this.unitStore });

    const pipeline = new Pipeline({
      ...config,
      steps: config?.steps ?? [
        {
          id: 'acquire',
          type: 'acquire',
          handler: createAcquireStep(acquisitionDeps),
          automationTier: 'local',
          params: {},
          enabled: true,
        },
        {
          id: 'retrieve',
          type: 'retrieve',
          handler: createRetrieveStep(retriever),
          automationTier: 'local',
          params: {},
          enabled: true,
        },
        {
          id: 'assemble',
          type: 'assemble',
          handler: createAssembleStep(assembler),
          automationTier: 'local',
          params: {},
          enabled: true,
        },
        {
          id: 'process',
          type: 'process',
          handler: createProcessStep(this.agentAdapter),
          automationTier: 'llm',
          params: {},
          enabled: true,
        },
        {
          id: 'triage',
          type: 'triage',
          handler: createTriageStep(acquisitionDeps),
          automationTier: 'local',
          params: {},
          enabled: true,
        },
      ],
      profiles: config?.profiles ?? [
        {
          name: 'full',
          steps: ['acquire', 'retrieve', 'assemble', 'process', 'triage'],
          description: 'Full cycle: acquire, retrieve, assemble, process, triage',
        },
        {
          name: 'retrieve-and-process',
          steps: ['retrieve', 'assemble', 'process'],
          description: 'Skip acquisition — retrieve existing knowledge, process',
        },
        {
          name: 'acquire-only',
          steps: ['acquire'],
          description: 'Ingest content without processing',
        },
        {
          name: 'retrieve-only',
          steps: ['retrieve', 'assemble'],
          description: 'Retrieve and assemble context without agent processing',
        },
      ],
      defaultProfile: config?.defaultProfile ?? 'full',
    });

    return pipeline;
  }
}
