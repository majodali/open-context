/**
 * Seed content: the initial knowledge base for a new OpenContext instance.
 *
 * This is the "operating manual" that the initial agent reads to understand
 * how the system works and how to evolve it. It includes:
 * - What bounded contexts are and how the hierarchy works
 * - What scope weights do and how to tune them
 * - What the pipeline does and how to configure it
 * - What roles are and how to define them
 * - The curation cycle and how to optimize
 * - Governance: write rules, proposals, and modification processes
 *
 * Seed content is acquired into the root context as 'instruction', 'rule',
 * and 'fact' units. The initial agent can read, reason about, and eventually
 * modify these as the project evolves.
 */

import type { AcquireOptions, ContentType } from './types.js';

export interface SeedUnit {
  content: string;
  contentType: ContentType;
  tags: string[];
}

/**
 * Core seed content that explains the OpenContext system to itself.
 */
export const OPENCONTEXT_SEED: SeedUnit[] = [
  // -- System overview --
  {
    content:
      'OpenContext organizes knowledge into semantic units indexed by vector embeddings ' +
      'and organized in a hierarchical work breakdown structure of bounded contexts.',
    contentType: 'fact',
    tags: ['seed', 'system-overview'],
  },
  {
    content:
      'Each bounded context represents a scope of work or responsibility. ' +
      'Contexts form a tree: a root context contains child contexts, which may have their own children.',
    contentType: 'fact',
    tags: ['seed', 'bounded-context'],
  },

  // -- Scope and retrieval --
  {
    content:
      'When retrieving knowledge, the system searches the current context and related contexts ' +
      'with weighted scoring. Closer contexts get higher weight, but distant contexts are never ' +
      'fully excluded — highly relevant information can surface from anywhere.',
    contentType: 'fact',
    tags: ['seed', 'retrieval'],
  },
  {
    content:
      'Scope weights are tunable per context: selfWeight, parentWeight, siblingWeight, childWeight, ' +
      'depthDecay, and minWeight. Adjusting these changes what knowledge is most visible during retrieval.',
    contentType: 'instruction',
    tags: ['seed', 'scope-rules', 'tunable'],
  },

  // -- Pipeline --
  {
    content:
      'The pipeline processes knowledge through configurable steps: acquire, retrieve, assemble, ' +
      'process, and triage. Steps can be collapsed, reordered, or the entire cycle can run as a ' +
      'single agent step with tool access to the knowledge store.',
    contentType: 'fact',
    tags: ['seed', 'pipeline'],
  },
  {
    content:
      'Pipeline profiles define which steps run for different task types. ' +
      'Use "full" for the complete cycle, "retrieve-and-process" to skip acquisition, ' +
      '"acquire-only" to ingest without processing, "retrieve-only" to assemble context without an agent.',
    contentType: 'instruction',
    tags: ['seed', 'pipeline', 'profiles'],
  },

  // -- Roles and agents --
  {
    content:
      'Agent roles are defined as knowledge units with contentType "role-definition". ' +
      'A role definition specifies the agent model, its assigned context, its responsibilities, ' +
      'and any special instructions. Initially there is one agent handling everything.',
    contentType: 'fact',
    tags: ['seed', 'roles'],
  },
  {
    content:
      'As the project evolves, specialize by creating child contexts with dedicated roles. ' +
      'Each role gets write access to its assigned context only. ' +
      'This naturally creates governance through the hierarchy.',
    contentType: 'instruction',
    tags: ['seed', 'roles', 'specialization'],
  },

  // -- Governance --
  {
    content:
      'Write access is strictly scoped: an agent can only write to the context it is assigned to. ' +
      'To modify knowledge in another context, the agent must create a proposal in its own context. ' +
      'The agent responsible for the target context retrieves and evaluates the proposal.',
    contentType: 'rule',
    tags: ['seed', 'governance', 'write-rules'],
  },
  {
    content:
      'The position in the hierarchy determines governance. Rules in the root context are hard to change — ' +
      'only root-level agents can modify them. Rules in leaf contexts are freely modifiable by local agents.',
    contentType: 'fact',
    tags: ['seed', 'governance'],
  },
  {
    content:
      'Proposals have a lifecycle: pending → approved → applied, or pending → rejected. ' +
      'The approval process is itself defined as knowledge within each context — ' +
      'different contexts can have different approval processes.',
    contentType: 'fact',
    tags: ['seed', 'governance', 'proposals'],
  },

  // -- Configuration --
  {
    content:
      'System configuration is stored as knowledge units with contentType "configuration". ' +
      'Configuration uses a "key: value" format where the value is JSON. ' +
      'Configuration resolves hierarchically: root configs are defaults, child contexts can override.',
    contentType: 'fact',
    tags: ['seed', 'configuration'],
  },

  // -- Planning and Learning Cycle --
  {
    content:
      'Every activity has a plan. The plan defines what success looks like. ' +
      'Mature activities have expectations (performance baselines that should be met). ' +
      'Immature activities have hypotheses (testable predictions about what will work). ' +
      'Even mature activities have implicit hypotheses — setting a baseline assumes it is achievable.',
    contentType: 'rule',
    tags: ['seed', 'planning', 'learning'],
  },
  {
    content:
      'Activities have a maturity level: experimental (first attempt, high uncertainty), ' +
      'emerging (patterns forming, hypotheses being tested), or established (well-understood, ' +
      'predictable). Maturity levels change based on evaluation results.',
    contentType: 'fact',
    tags: ['seed', 'planning', 'maturity'],
  },
  {
    content:
      'The planning-learning cycle: (1) create a plan with expectations and hypotheses, ' +
      '(2) structure work to enable meaningful evaluation, (3) execute, ' +
      '(4) evaluate execution against the plan, (5) produce learnings, ' +
      '(6) revise the plan based on learnings, (7) repeat.',
    contentType: 'instruction',
    tags: ['seed', 'planning', 'learning', 'process'],
  },
  {
    content:
      'Before executing, the orchestrator should structure the activity to enable evaluation. ' +
      'This means: ensure enough runs to be statistically meaningful, ' +
      'isolate variables when testing changes, establish clear before/after boundaries.',
    contentType: 'instruction',
    tags: ['seed', 'planning', 'evaluation-strategy'],
  },
  {
    content:
      'For experimental activities, the primary goal is learning, not performance. ' +
      'Form explicit hypotheses about what will work. Define what would validate or ' +
      'invalidate each hypothesis. Set a minimum number of observations before evaluating.',
    contentType: 'instruction',
    tags: ['seed', 'planning', 'experimental'],
  },
  {
    content:
      'For established activities, monitor expectations continuously. ' +
      'When expectations are consistently met, the activity is healthy. ' +
      'When expectations are missed beyond tolerance, investigate — either the baseline ' +
      'is wrong or something has changed.',
    contentType: 'instruction',
    tags: ['seed', 'planning', 'established'],
  },
  {
    content:
      'When a hypothesis is validated, it becomes an established fact or rule. ' +
      'When invalidated, record the learning and form alternative hypotheses. ' +
      'When inconclusive, gather more data or refine the experiment.',
    contentType: 'rule',
    tags: ['seed', 'learning', 'hypotheses'],
  },
  {
    content:
      'Optimization follows an A/B approach: propose a discrete change (split a task, adjust a weight, ' +
      'change an agent model), apply it, and compare outcomes against the plan baseline. ' +
      'Every proposed change should have a hypothesis about its expected effect.',
    contentType: 'instruction',
    tags: ['seed', 'learning', 'optimization'],
  },
  {
    content:
      'Learnings are immutable records — they capture what was observed and concluded at a point in time. ' +
      'Plans are mutable assertions — they are revised as learnings accumulate. ' +
      'The history of plan revisions is itself a learning trajectory.',
    contentType: 'fact',
    tags: ['seed', 'learning', 'knowledge-model'],
  },

  // -- Curation --
  {
    content:
      'Curation is the function of improving the knowledge base and system processes. ' +
      'It reads metrics, evaluates against plans, and proposes changes. ' +
      'Curation covers knowledge quality (stale, contradictory, or missing knowledge), ' +
      'process optimization (scope weights, assembly templates, model selection), ' +
      'and structural optimization (context hierarchy, role specialization).',
    contentType: 'fact',
    tags: ['seed', 'curation'],
  },
  {
    content:
      'As part of the curation cycle, query child contexts for pending proposals. ' +
      'Evaluate each proposal against current metrics, the plan, and project goals ' +
      'before approving or rejecting.',
    contentType: 'instruction',
    tags: ['seed', 'curation', 'proposals'],
  },

  // -- Knowledge types --
  {
    content:
      'Semantic units have a mutability field: "assertion" for revisable knowledge that can be ' +
      'superseded by newer information, and "record" for immutable structured data like metrics ' +
      'snapshots, logs, and audit entries. Records are evidence; assertions are beliefs.',
    contentType: 'fact',
    tags: ['seed', 'knowledge-model'],
  },
  {
    content:
      'The supersedes field on a unit links it to the unit it replaces. ' +
      'Only assertion units can be superseded. The config resolver and retriever ' +
      'automatically prefer the latest non-superseded unit.',
    contentType: 'fact',
    tags: ['seed', 'knowledge-model', 'versioning'],
  },
];

/**
 * Convert seed content into acquire options for ingestion.
 */
export function getSeedAcquireOptions(unit: SeedUnit): AcquireOptions {
  return {
    sourceType: 'system',
    contentType: unit.contentType,
    tags: unit.tags,
    createdBy: 'system:seed',
    mutability: 'assertion',
  };
}
