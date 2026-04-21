/**
 * Meta-Actions — the six orchestration actions that implement the planning-
 * execution-learning cycle.
 *
 * These actions are themselves stored as semantic units (action-definition
 * content type) in the system context. The orchestrator agent invokes them
 * to drive the happy-path flow:
 *
 *   1. ClassifyObjective    — search domain for relevant types/instances
 *   2. ClarifyObjective     — express objective in domain terms (may use user input)
 *   3. SearchActions        — find candidate actions for the objective
 *   4. SelectActions        — choose action(s) or propose new ones
 *   5. ExecuteActions       — run selected action(s) (may produce sub-DAGs)
 *   6. IncorporateResults   — update domain, plan, knowledge from outputs
 *
 * Each meta-action declares its inputs, outputs (with JSON schemas), query
 * templates targeting the kinds of knowledge it needs, and validation criteria.
 *
 * Meta-actions are seed content — they bootstrap the system, but can be
 * refined by the curation agent over time like any other action.
 */

import type { ActionDefinition } from './action-model.js';

// ---------------------------------------------------------------------------
// Output schemas (used both for validation and to inform the agent)
// ---------------------------------------------------------------------------

const CLASSIFICATION_SCHEMA = {
  type: 'object',
  required: ['matches', 'gaps'],
  properties: {
    matches: {
      type: 'array',
      description: 'Domain elements relevant to the objective',
      items: {
        type: 'object',
        required: ['id', 'kind', 'relevance'],
        properties: {
          id: { type: 'string', description: 'Domain element ID' },
          kind: {
            type: 'string',
            enum: ['resource-type', 'resource', 'relationship-type', 'relationship'],
          },
          relevance: { type: 'number', minimum: 0, maximum: 1 },
          rationale: { type: 'string' },
        },
      },
    },
    gaps: {
      type: 'array',
      description: 'Concepts referenced by the objective but not in the domain model',
      items: {
        type: 'object',
        required: ['concept'],
        properties: {
          concept: { type: 'string' },
          suggestedKind: {
            type: 'string',
            enum: ['resource-type', 'relationship-type', 'unknown'],
          },
          notes: { type: 'string' },
        },
      },
    },
    overallConfidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const CLARIFICATION_SCHEMA = {
  type: 'object',
  required: ['structuredObjective', 'isFullyClarified'],
  properties: {
    structuredObjective: {
      type: 'object',
      required: ['description', 'domainReferences', 'acceptanceCriteria'],
      properties: {
        description: { type: 'string' },
        domainReferences: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'role'],
            properties: {
              id: { type: 'string' },
              role: { type: 'string', description: 'How this element relates: input, output, constraint, etc.' },
            },
          },
        },
        acceptanceCriteria: {
          type: 'array',
          items: { type: 'string' },
          minLength: 1,
        },
      },
    },
    isFullyClarified: { type: 'boolean' },
    remainingAmbiguities: {
      type: 'array',
      items: { type: 'string' },
    },
    domainAdditions: {
      type: 'array',
      description: 'New domain elements that should be added (if any)',
      items: {
        type: 'object',
        required: ['kind', 'name', 'description'],
        properties: {
          kind: { type: 'string', enum: ['resource-type', 'resource', 'relationship-type'] },
          name: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
  },
};

const ACTION_SEARCH_SCHEMA = {
  type: 'object',
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['actionId', 'relevance'],
        properties: {
          actionId: { type: 'string' },
          relevance: { type: 'number', minimum: 0, maximum: 1 },
          rationale: { type: 'string' },
          gaps: {
            type: 'array',
            description: 'Inputs/outputs of the action that may not align with the objective',
            items: { type: 'string' },
          },
        },
      },
    },
    coverageAssessment: {
      type: 'string',
      enum: ['complete', 'partial', 'insufficient', 'none'],
      description: 'How well do the candidates cover the objective',
    },
  },
};

const ACTION_SELECTION_SCHEMA = {
  type: 'object',
  required: ['decision'],
  properties: {
    decision: {
      type: 'string',
      enum: ['select-one', 'select-multiple', 'create-new', 'create-exploratory', 'combine'],
    },
    selectedActionIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'For select-one or select-multiple decisions',
    },
    executionMode: {
      type: 'string',
      enum: ['sequential', 'parallel', 'alternative'],
    },
    newActionProposal: {
      type: 'object',
      description: 'For create-new or create-exploratory decisions',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        purpose: { type: 'string', enum: ['regular', 'exploratory', 'planning'] },
        rationale: { type: 'string' },
      },
    },
    rationale: { type: 'string' },
  },
};

const EXECUTION_RESULT_SCHEMA = {
  type: 'object',
  required: ['outcomes'],
  properties: {
    outcomes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['actionId', 'status'],
        properties: {
          actionId: { type: 'string' },
          status: { type: 'string', enum: ['succeeded', 'failed', 'partial', 'deferred'] },
          producedSubPlan: { type: 'boolean', description: 'True for planning actions' },
          subPlanId: { type: 'string' },
          outputs: { type: 'object' },
          error: { type: 'string' },
        },
      },
    },
  },
};

const INCORPORATION_SCHEMA = {
  type: 'object',
  required: ['updates'],
  properties: {
    updates: {
      type: 'object',
      properties: {
        domainChanges: {
          type: 'array',
          items: {
            type: 'object',
            required: ['kind', 'description'],
            properties: {
              kind: { type: 'string', enum: ['create', 'update', 'remove'] },
              targetType: {
                type: 'string',
                enum: ['resource-type', 'resource', 'relationship-type', 'relationship'],
              },
              description: { type: 'string' },
            },
          },
        },
        planUpdates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['add-nodes', 'mark-complete', 'add-sub-plan', 'revise-plan'] },
              description: { type: 'string' },
            },
          },
        },
        learnings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['observation'],
            properties: {
              observation: { type: 'string' },
              recommendation: { type: 'string' },
              category: {
                type: 'string',
                enum: ['action-refinement', 'domain-gap', 'process-improvement', 'knowledge-quality', 'other'],
              },
            },
          },
        },
      },
    },
    objectiveStatus: {
      type: 'string',
      enum: ['completed', 'in-progress', 'blocked', 'failed'],
    },
  },
};

// ---------------------------------------------------------------------------
// Meta-action definitions
// ---------------------------------------------------------------------------

/**
 * Build the meta-actions for a given system context ID.
 * Pass the ID of the bounded context where meta-actions live (typically
 * a dedicated 'system' or root context).
 */
export function buildMetaActions(systemContextId: string): ActionDefinition[] {
  return [
    classifyObjectiveAction(systemContextId),
    clarifyObjectiveAction(systemContextId),
    searchActionsAction(systemContextId),
    selectActionsAction(systemContextId),
    executeActionsAction(systemContextId),
    incorporateResultsAction(systemContextId),
  ];
}

function classifyObjectiveAction(contextId: string): ActionDefinition {
  return {
    id: 'meta:classify-objective',
    name: 'Classify Objective',
    description:
      'Search the domain model for resource types, resources, and relationships ' +
      'relevant to an objective. Identifies known concepts and gaps where the ' +
      'objective references things not yet in the domain model.',
    contextId,
    inputs: [
      {
        name: 'objectiveDescription',
        description: 'Natural-language description of the objective',
        required: true,
      },
      {
        name: 'targetContextId',
        description: 'The bounded context the objective is being pursued in',
        required: true,
      },
    ],
    outputs: [
      {
        name: 'classification',
        description: 'Domain elements matched, gaps identified, overall confidence',
        required: true,
      },
    ],
    outputSchema: CLASSIFICATION_SCHEMA,
    performer: { type: 'agent' },
    instructions:
      'Read the objective description carefully. Search the available domain knowledge ' +
      '(resource types, resources, relationships) and identify which elements are ' +
      'directly relevant. Score relevance 0-1 with brief rationale. Identify any ' +
      'concepts the objective references that are NOT in the domain model — these ' +
      'are gaps that downstream steps may need to address. Be specific: prefer ' +
      'concrete domain element IDs over generic categories. If the domain model is ' +
      'sparse or empty, that is fine — return empty matches and document gaps.',
    parameters: [],
    queryTemplates: [
      // Prefer formal domain-model entries if they exist (highest priority),
      // but don't rely on them — fall back to general knowledge about the
      // concepts referenced by the objective.
      {
        purpose: 'domain-model-types',
        query: 'Resource types and their properties relevant to: {{objectiveDescription}}',
        contentTypes: ['domain-entity'],
        maxResults: 15,
        priority: 10,
      },
      {
        purpose: 'domain-model-resources',
        query: 'Existing resources mentioned or related to: {{objectiveDescription}}',
        contentTypes: ['domain-resource'],
        maxResults: 10,
        priority: 9,
      },
      {
        purpose: 'domain-model-relationships',
        query: 'Relationships between concepts in: {{objectiveDescription}}',
        contentTypes: ['domain-relationship'],
        maxResults: 10,
        priority: 8,
      },
      // Broad knowledge retrieval — no contentType filter. Finds any units
      // (facts, rules, instructions, decisions) discussing the concepts in
      // the objective. Relevance scoring orders these; the agent sees all
      // of them and uses its judgment about which concepts are the domain
      // types and instances.
      {
        purpose: 'general-concept-knowledge',
        query: 'Concepts, entities, constraints, and relationships referenced in: {{objectiveDescription}}',
        maxResults: 25,
        priority: 7,
      },
    ],
    validations: [
      {
        id: 'v-schema',
        description: 'Output matches classification schema',
        method: 'schema',
        schema: CLASSIFICATION_SCHEMA,
        blocking: true,
        onFailure: 'feedback-and-retry',
      },
    ],
    riskIndicators: [],
    maxAttempts: 2,
    tags: ['meta-action', 'orchestration', 'classification'],
  };
}

function clarifyObjectiveAction(contextId: string): ActionDefinition {
  return {
    id: 'meta:clarify-objective',
    name: 'Clarify Objective',
    description:
      'Express the objective in domain terms using the classification results. ' +
      'May request user input via tools when ambiguous. Produces a structured ' +
      'objective with explicit domain references and acceptance criteria.',
    contextId,
    inputs: [
      { name: 'objectiveDescription', description: 'Original objective description', required: true },
      { name: 'classification', description: 'Output from classify-objective', required: true },
    ],
    outputs: [
      {
        name: 'clarifiedObjective',
        description: 'Structured objective with domain references and acceptance criteria',
        required: true,
      },
    ],
    outputSchema: CLARIFICATION_SCHEMA,
    performer: { type: 'agent' },
    instructions:
      'Using the classification results, express the objective in concrete domain ' +
      'terms. Reference specific resource types, resources, and relationships. ' +
      'Define acceptance criteria — how will we know the objective is met? ' +
      'If critical information is missing, use the request_user_input tool to ' +
      'ask. For automated/headless mode, make reasonable assumptions and document ' +
      'them in remainingAmbiguities. If the classification identified gaps, ' +
      'propose minimal domain additions needed for clarity (in domainAdditions). ' +
      'Set isFullyClarified=false if you have to make significant assumptions.',
    parameters: [],
    queryTemplates: [
      {
        purpose: 'domain-conventions',
        query: 'Conventions, decisions, and rules for the project domain related to: {{objectiveDescription}}',
        contentTypes: ['rule', 'decision', 'configuration'],
        maxResults: 15,
        priority: 8,
      },
      {
        purpose: 'similar-objectives',
        query: 'Previously clarified objectives or specifications similar to: {{objectiveDescription}}',
        contentTypes: ['objective', 'plan', 'fact'],
        maxResults: 10,
        priority: 6,
      },
      // Broad fallback — ensures we include context even if narrow filters miss.
      {
        purpose: 'general-objective-context',
        query: 'Domain concepts, constraints, practices, and methodology relevant to: {{objectiveDescription}}',
        maxResults: 20,
        priority: 5,
      },
    ],
    validations: [
      {
        id: 'v-schema',
        description: 'Output matches clarification schema',
        method: 'schema',
        schema: CLARIFICATION_SCHEMA,
        blocking: true,
        onFailure: 'feedback-and-retry',
      },
    ],
    riskIndicators: [],
    maxAttempts: 2,
    tags: ['meta-action', 'orchestration', 'clarification'],
  };
}

function searchActionsAction(contextId: string): ActionDefinition {
  return {
    id: 'meta:search-actions',
    name: 'Search Actions',
    description:
      'Find action definitions in the knowledge base that could deliver the ' +
      'clarified objective. Ranks candidates by relevance with rationale and ' +
      'identifies any gaps in coverage.',
    contextId,
    inputs: [
      { name: 'clarifiedObjective', description: 'Output from clarify-objective', required: true },
    ],
    outputs: [
      { name: 'searchResult', description: 'Ranked candidate actions with rationale', required: true },
    ],
    outputSchema: ACTION_SEARCH_SCHEMA,
    performer: { type: 'agent' },
    instructions:
      'Search the action definitions in the knowledge base for actions whose ' +
      'outputs could satisfy the clarified objective. Consider: do the action ' +
      'outputs match what the objective needs? Are the action inputs available ' +
      'or producible? Does the action operate in a relevant domain? Rank candidates ' +
      'by relevance (0-1). Provide brief rationale for each. Note any gaps where ' +
      'the action does not fully cover the objective. Set coverageAssessment to ' +
      'reflect overall fit: "complete" (one or more actions fully match), "partial" ' +
      '(actions cover some but not all), "insufficient" (loose matches only), or ' +
      '"none" (no relevant actions found — will need to create new action).',
    parameters: [],
    queryTemplates: [
      {
        purpose: 'candidate-actions',
        query: 'Action definitions that could produce or contribute to: {{clarifiedObjective}}',
        contentTypes: ['action-definition'],
        maxResults: 30,
        priority: 10,
      },
      {
        purpose: 'related-action-experience',
        query: 'Past learnings, outcomes, and feedback about actions related to: {{clarifiedObjective}}',
        contentTypes: ['learning', 'insight', 'observation'],
        maxResults: 15,
        priority: 6,
      },
    ],
    validations: [
      {
        id: 'v-schema',
        description: 'Output matches search result schema',
        method: 'schema',
        schema: ACTION_SEARCH_SCHEMA,
        blocking: true,
        onFailure: 'feedback-and-retry',
      },
    ],
    riskIndicators: [],
    maxAttempts: 2,
    tags: ['meta-action', 'orchestration', 'action-search'],
  };
}

function selectActionsAction(contextId: string): ActionDefinition {
  return {
    id: 'meta:select-actions',
    name: 'Select Actions',
    description:
      'Choose action(s) to execute, or decide that a new action must be created. ' +
      'For ambiguous candidate sets, may propose combining or refining actions. ' +
      'For zero-coverage situations, proposes either a regular new action ' +
      '(if clear) or an exploratory action (whose output is itself a plan or ' +
      'better action definition).',
    contextId,
    inputs: [
      { name: 'clarifiedObjective', description: 'The objective to deliver', required: true },
      { name: 'searchResult', description: 'Output from search-actions', required: true },
    ],
    outputs: [
      { name: 'selection', description: 'Chosen actions or new action proposal', required: true },
    ],
    outputSchema: ACTION_SELECTION_SCHEMA,
    performer: { type: 'agent' },
    instructions:
      'Based on the search results, decide how to proceed:\n' +
      '- "select-one": one candidate clearly fits — pick it\n' +
      '- "select-multiple": multiple actions needed (sequential, parallel, or as alternatives)\n' +
      '- "combine": multiple candidate actions should be merged into a new combined action\n' +
      '- "create-new": no fit, but the needed action is clear — propose its definition\n' +
      '- "create-exploratory": no fit and unclear how to proceed — propose an ' +
      'exploratory action whose output is a plan or better action definition\n' +
      '\nFor "select-multiple": specify executionMode (sequential, parallel, alternative).\n' +
      'For "create-new" / "create-exploratory" / "combine": provide the new action ' +
      'proposal with name, description, and rationale.\n' +
      'Always include rationale explaining the choice.',
    parameters: [],
    queryTemplates: [
      {
        purpose: 'action-selection-guidance',
        query: 'Principles, heuristics, and learnings about choosing between candidate actions and creating new ones',
        contentTypes: ['rule', 'instruction', 'learning'],
        maxResults: 10,
        priority: 8,
      },
      // Broad methodology context — selection often depends on general planning
      // practices (decompose, consider alternatives, risk-first).
      {
        purpose: 'methodology-for-selection',
        query: 'Methodology and planning practices relevant to selecting actions or structuring work',
        maxResults: 15,
        priority: 7,
      },
    ],
    validations: [
      {
        id: 'v-schema',
        description: 'Output matches selection schema',
        method: 'schema',
        schema: ACTION_SELECTION_SCHEMA,
        blocking: true,
        onFailure: 'feedback-and-retry',
      },
    ],
    riskIndicators: [],
    maxAttempts: 2,
    tags: ['meta-action', 'orchestration', 'action-selection'],
  };
}

function executeActionsAction(contextId: string): ActionDefinition {
  return {
    id: 'meta:execute-actions',
    name: 'Execute Actions',
    description:
      'Execute the selected action(s). For multiple actions, coordinate ' +
      'sequential or parallel execution. For planning actions, the output ' +
      'is a sub-DAG that gets added to the overall plan rather than executed ' +
      'immediately. The DAG engine picks up new nodes when their inputs are ready.',
    contextId,
    inputs: [
      { name: 'selection', description: 'Output from select-actions', required: true },
    ],
    outputs: [
      { name: 'executionResult', description: 'Status and outputs from each action', required: true },
    ],
    outputSchema: EXECUTION_RESULT_SCHEMA,
    performer: { type: 'agent' },
    instructions:
      'Coordinate execution of the selected action(s). Most of the actual ' +
      'execution happens via the DAG engine — your job is to:\n' +
      '1. Verify all required inputs are available (or note that they need to ' +
      'be produced first)\n' +
      '2. Insert the action(s) into the plan DAG with appropriate dependencies\n' +
      '3. For planning actions, the output is a sub-DAG of nodes — insert these ' +
      'into the overall plan rather than executing them inline (recursion is ' +
      'flattened through the plan structure)\n' +
      '4. Report status for each action: succeeded, failed, partial, or deferred ' +
      '(waiting for inputs)\n' +
      '5. For each action, identify whether it produced a sub-plan that needs ' +
      'further work',
    parameters: [],
    queryTemplates: [
      {
        purpose: 'execution-context',
        query: 'Current plan state and resource availability for: {{selection}}',
        contentTypes: ['plan', 'plan-dag', 'domain-resource'],
        maxResults: 20,
        priority: 10,
      },
      // Broad fallback — find any guidance about executing the selected actions.
      {
        purpose: 'general-execution-context',
        query: 'Practices, constraints, and prior knowledge relevant to executing: {{selection}}',
        maxResults: 20,
        priority: 7,
      },
    ],
    validations: [
      {
        id: 'v-schema',
        description: 'Output matches execution result schema',
        method: 'schema',
        schema: EXECUTION_RESULT_SCHEMA,
        blocking: true,
        onFailure: 'feedback-and-retry',
      },
    ],
    riskIndicators: [],
    maxAttempts: 2,
    tags: ['meta-action', 'orchestration', 'execution'],
  };
}

function incorporateResultsAction(contextId: string): ActionDefinition {
  return {
    id: 'meta:incorporate-results',
    name: 'Incorporate Results',
    description:
      'Update the domain model, plan DAG, and knowledge base based on action ' +
      'outputs. May trigger deferred actions whose inputs are now available. ' +
      'Records learnings from successful and failed attempts.',
    contextId,
    inputs: [
      { name: 'executionResult', description: 'Output from execute-actions', required: true },
      { name: 'clarifiedObjective', description: 'The objective being pursued', required: true },
    ],
    outputs: [
      { name: 'incorporation', description: 'Summary of updates and overall objective status', required: true },
    ],
    outputSchema: INCORPORATION_SCHEMA,
    performer: { type: 'agent' },
    instructions:
      'Process the execution results and integrate them:\n' +
      '1. Identify domain model changes — what new resources, types, or ' +
      'relationships should be created or updated based on the action outputs?\n' +
      '2. Identify plan updates — mark completed nodes, add sub-plans from ' +
      'planning actions, propose plan revisions if results indicate the plan ' +
      'is wrong\n' +
      '3. Capture learnings — what was observed, what should be improved? ' +
      'Categorize: action-refinement (tweak action def), domain-gap (model is ' +
      'missing something), process-improvement (orchestration could be better), ' +
      'knowledge-quality (data needs cleaning)\n' +
      '4. Determine objective status: completed (acceptance criteria met), ' +
      'in-progress (more work needed), blocked (cannot proceed), failed ' +
      '(cannot meet criteria with current approach)',
    parameters: [],
    queryTemplates: [
      {
        purpose: 'objective-context',
        query: 'Acceptance criteria and progress for: {{clarifiedObjective}}',
        contentTypes: ['objective', 'plan', 'expectation'],
        maxResults: 10,
        priority: 10,
      },
      {
        purpose: 'curation-guidance',
        query: 'Curation principles and learning practices for incorporating action results',
        contentTypes: ['rule', 'instruction'],
        maxResults: 10,
        priority: 7,
      },
      // Broad fallback to find relevant domain knowledge or lessons.
      {
        purpose: 'general-incorporation-context',
        query: 'Domain knowledge, lessons, observations, and prior outcomes relevant to: {{clarifiedObjective}}',
        maxResults: 20,
        priority: 5,
      },
    ],
    validations: [
      {
        id: 'v-schema',
        description: 'Output matches incorporation schema',
        method: 'schema',
        schema: INCORPORATION_SCHEMA,
        blocking: true,
        onFailure: 'feedback-and-retry',
      },
    ],
    riskIndicators: [],
    maxAttempts: 2,
    tags: ['meta-action', 'orchestration', 'incorporation'],
  };
}

// ---------------------------------------------------------------------------
// Convenience: meta-action IDs as constants
// ---------------------------------------------------------------------------

export const META_ACTION_IDS = {
  CLASSIFY: 'meta:classify-objective',
  CLARIFY: 'meta:clarify-objective',
  SEARCH: 'meta:search-actions',
  SELECT: 'meta:select-actions',
  EXECUTE: 'meta:execute-actions',
  INCORPORATE: 'meta:incorporate-results',
} as const;
