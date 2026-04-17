/**
 * QueryConstructor: builds knowledge retrieval queries from action definitions.
 *
 * The query constructor is the bridge between what an action needs (defined
 * in its ports, instructions, and context) and the knowledge retrieval system.
 * It constructs one or more queries designed to surface all the knowledge
 * the agent will need to execute the action — ideally making the initial
 * retrieval sufficient so the agent doesn't need additional queries.
 *
 * Query construction is a key optimization target. The current implementation
 * builds queries from action metadata; a future trained model would replace
 * or augment this with learned retrieval.
 */

import type { ActionDefinition, ActionPort } from './action-model.js';
import type { Objective } from './plan-dag.js';
import type { RetrievalOptions, RetrievalResult, ScoredUnit, ContentType } from '../core/types.js';
import type { Retriever } from '../retrieval/retriever.js';

// ---------------------------------------------------------------------------
// Query specification
// ---------------------------------------------------------------------------

/**
 * A constructed query — one or more retrieval requests built from
 * an action definition, plus assembly instructions.
 */
export interface ConstructedQuery {
  /** Individual retrieval requests, executed in order. */
  retrievals: RetrievalRequest[];
  /** The action this query was built for. */
  actionId: string;
  /** The context to query from. */
  contextId: string;
  /** Maximum total units across all retrievals. */
  maxTotalUnits: number;
}

/**
 * A single retrieval request — maps to one call to the Retriever.
 */
export interface RetrievalRequest {
  /** What to search for. */
  query: string;
  /** Why this retrieval is needed (for debugging and feedback). */
  purpose: string;
  /** Retrieval options (context, filters, limits). */
  options: RetrievalOptions;
  /** Priority relative to other requests (higher = more important). */
  priority: number;
}

/**
 * The result of executing a constructed query — all retrieved knowledge
 * ready to be assembled into agent input.
 */
export interface QueryResult {
  /** All retrieved units, deduplicated and sorted by score. */
  units: ScoredUnit[];
  /** Per-retrieval results, for feedback tracking. */
  retrievalResults: {
    purpose: string;
    query: string;
    unitsReturned: number;
  }[];
  /** The constructed query that produced this result. */
  source: ConstructedQuery;
}

// ---------------------------------------------------------------------------
// Query Constructor
// ---------------------------------------------------------------------------

export interface QueryConstructorConfig {
  /** Max units per individual retrieval. Default: 15 */
  maxUnitsPerRetrieval: number;
  /** Max total units across all retrievals. Default: 40 */
  maxTotalUnits: number;
  /** Whether to include project-level context. Default: true */
  includeProjectContext: boolean;
  /** Whether to retrieve action alternatives. Default: true */
  includeAlternatives: boolean;
}

const DEFAULT_CONFIG: QueryConstructorConfig = {
  maxUnitsPerRetrieval: 15,
  maxTotalUnits: 40,
  includeProjectContext: true,
  includeAlternatives: false,
};

export class QueryConstructor {
  private config: QueryConstructorConfig;

  constructor(config?: Partial<QueryConstructorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Build queries from an action definition and its execution context.
   */
  construct(
    action: ActionDefinition,
    objective: Objective | null,
    contextId: string,
  ): ConstructedQuery {
    const retrievals: RetrievalRequest[] = [];

    // 1. Primary query: the action's core purpose
    retrievals.push({
      query: this.buildPrimaryQuery(action, objective),
      purpose: 'primary-context',
      options: {
        contextId,
        maxResults: this.config.maxUnitsPerRetrieval,
      },
      priority: 10,
    });

    // 2. Instructions and rules: retrieve guidance relevant to this action
    retrievals.push({
      query: this.buildInstructionQuery(action),
      purpose: 'instructions-and-rules',
      options: {
        contextId,
        maxResults: Math.ceil(this.config.maxUnitsPerRetrieval * 0.7),
        contentTypes: ['instruction', 'rule', 'configuration', 'role-definition'],
      },
      priority: 9,
    });

    // 3. Practices and methodology: testing approach, quality standards,
    //    design discipline, epistemic practices. These are semantically
    //    distant from domain-specific tasks, so we query for them explicitly.
    retrievals.push({
      query: this.buildPracticesQuery(action),
      purpose: 'practices-and-methodology',
      options: {
        contextId,
        maxResults: Math.ceil(this.config.maxUnitsPerRetrieval * 0.7),
        contentTypes: ['instruction', 'rule'],
        tags: undefined, // Don't filter by tags — we want broad methodology
      },
      priority: 8,
    });

    // 4. Domain knowledge: relevant facts, decisions, observations
    retrievals.push({
      query: this.buildDomainQuery(action),
      purpose: 'domain-knowledge',
      options: {
        contextId,
        maxResults: this.config.maxUnitsPerRetrieval,
        contentTypes: ['fact', 'decision', 'observation', 'domain-entity', 'domain-resource', 'domain-relationship'],
      },
      priority: 7,
    });

    // 5. Input-specific retrieval: for each input port, find relevant knowledge
    for (const input of action.inputs) {
      if (input.resourceTypeId || input.description.length > 10) {
        retrievals.push({
          query: this.buildInputQuery(input, action),
          purpose: `input:${input.name}`,
          options: {
            contextId,
            maxResults: Math.ceil(this.config.maxUnitsPerRetrieval * 0.5),
          },
          priority: 6,
        });
      }
    }

    // 6. Learnings and insights: past experience with similar actions
    retrievals.push({
      query: `Previous learnings and insights for ${action.name}: outcomes, improvements, issues`,
      purpose: 'learnings',
      options: {
        contextId,
        maxResults: Math.ceil(this.config.maxUnitsPerRetrieval * 0.5),
        contentTypes: ['learning', 'insight'],
      },
      priority: 5,
    });

    // 7. Plan context: the current objective and plan
    if (objective) {
      retrievals.push({
        query: `Plan and objectives: ${objective.name}. ${objective.description}. Acceptance criteria: ${objective.acceptanceCriteria.join('; ')}`,
        purpose: 'plan-context',
        options: {
          contextId: objective.contextId,
          maxResults: Math.ceil(this.config.maxUnitsPerRetrieval * 0.5),
          contentTypes: ['plan', 'objective', 'expectation', 'hypothesis'],
        },
        priority: 4,
      });
    }

    // Sort by priority (highest first)
    retrievals.sort((a, b) => b.priority - a.priority);

    return {
      retrievals,
      actionId: action.id,
      contextId,
      maxTotalUnits: this.config.maxTotalUnits,
    };
  }

  /**
   * Execute a constructed query against the retriever.
   * Deduplicates and respects total unit budget.
   */
  async execute(
    query: ConstructedQuery,
    retriever: Retriever,
  ): Promise<QueryResult> {
    const allUnits: ScoredUnit[] = [];
    const seenIds = new Set<string>();
    const retrievalResults: QueryResult['retrievalResults'] = [];

    for (const request of query.retrievals) {
      if (allUnits.length >= query.maxTotalUnits) break;

      const remaining = query.maxTotalUnits - allUnits.length;
      const opts = {
        ...request.options,
        maxResults: Math.min(request.options.maxResults, remaining),
      };

      const result = await retriever.retrieve(request.query, opts);

      let added = 0;
      for (const su of result.units) {
        if (!seenIds.has(su.unit.id)) {
          seenIds.add(su.unit.id);
          allUnits.push(su);
          added++;
        }
      }

      retrievalResults.push({
        purpose: request.purpose,
        query: request.query,
        unitsReturned: added,
      });
    }

    // Sort all units by score
    allUnits.sort((a, b) => b.score - a.score);

    return {
      units: allUnits.slice(0, query.maxTotalUnits),
      retrievalResults,
      source: query,
    };
  }

  // -- Private: query builders --

  private buildPrimaryQuery(action: ActionDefinition, objective: Objective | null): string {
    const parts: string[] = [];
    parts.push(action.description);
    if (objective) {
      parts.push(`Objective: ${objective.description}`);
    }
    if (action.instructions.length < 200) {
      parts.push(action.instructions);
    }
    return parts.join('. ');
  }

  private buildInstructionQuery(action: ActionDefinition): string {
    return `Instructions, rules, and guidance for: ${action.name}. ${action.description}. Requirements, constraints, and conventions.`;
  }

  private buildPracticesQuery(action: ActionDefinition): string {
    // Determine what kind of practices to retrieve based on action outputs
    const producesCode = action.outputs.some((o) =>
      /implementation|code|function|module|component/i.test(o.name + ' ' + o.description),
    );
    const producesTests = action.outputs.some((o) =>
      /test|spec|behavior|validation/i.test(o.name + ' ' + o.description),
    );
    const producesDesign = action.outputs.some((o) =>
      /design|architecture|specification|contract|interface/i.test(o.name + ' ' + o.description),
    );

    const parts: string[] = [];

    // Always include epistemic discipline
    parts.push('Before starting, consider alternatives and tradeoffs. Verify assumptions. Signal confidence level in conclusions.');

    if (producesDesign) {
      parts.push('Design practices: how to decompose and specify. V-model design with test specifications. Define acceptance criteria before implementation.');
    }
    if (producesTests || producesCode) {
      parts.push('Testing methodology: behavior-driven development, Given-When-Then specifications, specification by example. Write tests before implementation.');
    }
    if (producesCode) {
      parts.push('Code quality standards: naming conventions, error handling, module boundaries, dependency direction. Refactoring discipline.');
    }

    // Fallback for actions that don't clearly produce code/tests/design
    if (parts.length === 1) {
      parts.push(`Quality practices and methodology for: ${action.name}. Standards, review criteria, validation approach.`);
    }

    return parts.join(' ');
  }

  private buildDomainQuery(action: ActionDefinition): string {
    const entityRefs = [
      ...action.inputs.filter((p) => p.resourceTypeId).map((p) => p.resourceTypeId),
      ...action.outputs.filter((p) => p.resourceTypeId).map((p) => p.resourceTypeId),
    ].filter(Boolean);

    if (entityRefs.length > 0) {
      return `Domain knowledge about: ${entityRefs.join(', ')}. Properties, relationships, constraints for ${action.name}.`;
    }
    return `Domain knowledge relevant to: ${action.name}. ${action.description}`;
  }

  private buildInputQuery(input: ActionPort, action: ActionDefinition): string {
    const parts = [`Information about ${input.name}: ${input.description}`];
    if (input.resourceTypeId) {
      parts.push(`Resource type: ${input.resourceTypeId}`);
    }
    parts.push(`Needed for action: ${action.name}`);
    return parts.join('. ');
  }
}
