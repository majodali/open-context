/**
 * AgentActionExecutor: implements ActionExecutor for agent-type actions.
 *
 * The execution flow:
 * 1. Construct queries from the action definition
 * 2. Execute queries against the knowledge retriever
 * 3. Assemble retrieved knowledge into agent input
 * 4. Invoke the agent (LLM) with complete context
 * 5. Parse response: primary output + structured feedback
 * 6. Record feedback for training data accumulation
 * 7. Return outputs and validation results
 *
 * The agent receives a complete context — resolved inputs, relevant knowledge,
 * instructions, tools — ideally making the initial retrieval sufficient so
 * the agent doesn't need additional queries.
 */

import { v4 as uuidv4 } from 'uuid';
import type { ActionExecutor } from './dag-engine.js';
import type { PlanNode, ValidationResult, Objective } from './plan-dag.js';
import type { ActionDefinition } from './action-model.js';
import type { Retriever } from '../retrieval/retriever.js';
import type { AgentAdapter } from '../processing/agent-adapter.js';
import type { ScoredUnit, AssembledInput } from '../core/types.js';
import {
  QueryConstructor,
  type QueryConstructorConfig,
  type QueryResult,
} from './query-constructor.js';
import {
  parseFeedback,
  extractPrimaryResponse,
  FEEDBACK_INSTRUCTIONS,
  type ExecutionFeedback,
  type FeedbackRecord,
  type FeedbackStore,
} from './feedback.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AgentExecutorConfig {
  /** Query construction configuration. */
  queryConfig?: Partial<QueryConstructorConfig>;
  /** Maximum tokens for assembled context. */
  maxContextTokens: number;
  /** Whether to request structured feedback from agents. Default: true */
  requestFeedback: boolean;
  /** System prompt prepended to all agent invocations. */
  systemPrompt?: string;
}

const DEFAULT_CONFIG: AgentExecutorConfig = {
  maxContextTokens: 8000,
  requestFeedback: true,
};

// ---------------------------------------------------------------------------
// Agent Action Executor
// ---------------------------------------------------------------------------

export class AgentActionExecutor implements ActionExecutor {
  private queryConstructor: QueryConstructor;
  private config: AgentExecutorConfig;

  constructor(
    private retriever: Retriever,
    private agentAdapter: AgentAdapter,
    private feedbackStore: FeedbackStore,
    config?: Partial<AgentExecutorConfig>,
    private objectiveResolver?: (objectiveId: string) => Promise<Objective | null>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.queryConstructor = new QueryConstructor(this.config.queryConfig);
  }

  async execute(
    node: PlanNode,
    resolvedInputs: Record<string, unknown>,
  ): Promise<{
    outputs: Record<string, unknown>;
    validationResults: ValidationResult[];
    error?: string;
    executionMeta?: Record<string, unknown>;
  }> {
    const action = node.action;
    if (!action) {
      return { outputs: {}, validationResults: [], error: 'No action definition on node' };
    }

    try {
      // 1. Construct queries from action definition
      let objective: Objective | null = null;
      if (this.objectiveResolver && node.childPlanId) {
        // Try to find the objective for context
        objective = await this.objectiveResolver(node.childPlanId).catch(() => null);
      }

      const constructedQuery = this.queryConstructor.construct(
        action,
        objective,
        action.contextId,
      );

      // 2. Execute queries against the retriever
      const queryResult = await this.queryConstructor.execute(
        constructedQuery,
        this.retriever,
      );

      // 3. Assemble context for the agent
      const assembledInput = this.assembleContext(
        action,
        resolvedInputs,
        queryResult,
        node,
      );

      // 4. Invoke the agent
      const agentOutput = await this.agentAdapter.process(assembledInput);

      // 5. Parse feedback from response
      const primaryResponse = this.config.requestFeedback
        ? extractPrimaryResponse(agentOutput.response)
        : agentOutput.response;

      const feedback = this.config.requestFeedback
        ? parseFeedback(agentOutput.response, action.id, node.id)
        : null;

      // 6. Record feedback
      if (feedback) {
        const feedbackRecord: FeedbackRecord = {
          id: uuidv4(),
          feedback,
          queryRetrievalSummary: queryResult.retrievalResults,
          actionId: action.id,
          contextId: action.contextId,
          actionOutcome: 'succeeded', // May be updated if validation fails
        };
        await this.feedbackStore.record(feedbackRecord);
      }

      // 7. Build outputs
      const outputs: Record<string, unknown> = {
        response: primaryResponse,
        feedback,
      };

      // Map response to output ports
      for (const port of action.outputs) {
        if (port.name === 'response') {
          outputs[port.name] = primaryResponse;
        }
        // Tool call results would be mapped here too
      }

      // Include acquire hints from the agent
      if (agentOutput.acquireHints && agentOutput.acquireHints.length > 0) {
        outputs['__acquireHints'] = agentOutput.acquireHints;
      }

      // Include tool calls
      if (agentOutput.toolCalls && agentOutput.toolCalls.length > 0) {
        outputs['__toolCalls'] = agentOutput.toolCalls;
      }

      const validationResults: ValidationResult[] = [];

      // Run any assertion-type validations
      for (const validation of action.validations) {
        if (validation.method === 'assertion' && validation.expression) {
          const passed = this.evaluateAssertion(validation.expression, outputs);
          validationResults.push({
            validationId: validation.id,
            passed,
            detail: passed ? undefined : `Assertion failed: ${validation.expression}`,
          });
        }
        // agent-review and human-review validations are not executed here —
        // they're handled by the broader execution system
      }

      return {
        outputs,
        validationResults,
        executionMeta: {
          queryResult: {
            totalUnitsRetrieved: queryResult.units.length,
            retrievals: queryResult.retrievalResults,
          },
          agentMeta: agentOutput.metadata,
          feedbackSummary: feedback ? {
            contextQuality: feedback.contextQuality,
            usedUnits: feedback.usedUnits.length,
            unusedUnits: feedback.unusedUnits.length,
            missingInfo: feedback.missingInformation.length,
            additionalQueries: feedback.additionalQueries.length,
          } : null,
          attemptNumber: node.attemptCount,
          previousAttemptErrors: node.attempts
            .filter((a) => a.status === 'failed')
            .map((a) => a.error)
            .filter(Boolean),
        },
      };
    } catch (err) {
      return {
        outputs: {},
        validationResults: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // -- Private: Context Assembly --

  /**
   * Assemble the complete context for the agent.
   * Combines: action instructions, resolved inputs, retrieved knowledge,
   * attempt history (if retrying), and feedback instructions.
   */
  private assembleContext(
    action: ActionDefinition,
    resolvedInputs: Record<string, unknown>,
    queryResult: QueryResult,
    node: PlanNode,
  ): AssembledInput {
    const sections: { name: string; content: string }[] = [];
    let totalTokens = 0;

    const addSection = (name: string, content: string) => {
      const tokens = Math.ceil(content.length / 4);
      if (totalTokens + tokens <= this.config.maxContextTokens) {
        sections.push({ name, content });
        totalTokens += tokens;
      }
    };

    // System context
    if (this.config.systemPrompt) {
      addSection('system', this.config.systemPrompt);
    }

    // Action instructions
    addSection('instructions', [
      `## Task: ${action.name}`,
      '',
      action.description,
      '',
      '### Instructions',
      action.instructions,
      '',
      '### Expected Outputs',
      ...action.outputs.map((o) => `- **${o.name}**: ${o.description}`),
      '',
      '### Validation Criteria',
      ...action.validations.map((v) => `- ${v.description}`),
    ].join('\n'));

    // Resolved inputs from the DAG
    if (Object.keys(resolvedInputs).length > 0) {
      const inputLines = Object.entries(resolvedInputs).map(([key, value]) => {
        const strValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        return `**${key}**:\n${strValue}`;
      });
      addSection('inputs', '## Provided Inputs\n\n' + inputLines.join('\n\n'));
    }

    // Attempt history (for retries — inform the agent of previous failures)
    const failedAttempts = node.attempts.filter((a) => a.status === 'failed');
    if (failedAttempts.length > 0) {
      const attemptLines = failedAttempts.map((a) =>
        `Attempt ${a.attemptNumber}: Failed — ${a.error ?? 'unknown error'}`,
      );
      addSection('attempt-history', [
        '## Previous Attempts',
        `This is attempt ${node.attemptCount + 1}. Previous attempts failed:`,
        ...attemptLines,
        '',
        'Please try a different approach.',
      ].join('\n'));
    }

    // Retrieved knowledge (grouped by purpose)
    const knowledgeByPurpose = new Map<string, ScoredUnit[]>();
    for (const su of queryResult.units) {
      // Group by the retrieval purpose that found this unit
      const purpose = this.findPurpose(su, queryResult) ?? 'general';
      const list = knowledgeByPurpose.get(purpose) ?? [];
      list.push(su);
      knowledgeByPurpose.set(purpose, list);
    }

    for (const [purpose, units] of knowledgeByPurpose) {
      const lines = units.map((su) =>
        `- [${su.unit.metadata.contentType}] (id:${su.unit.id.substring(0, 8)}) ${su.unit.content}`,
      );
      addSection(
        `knowledge:${purpose}`,
        `## Knowledge: ${purpose}\n\n${lines.join('\n')}`,
      );
    }

    // Feedback instructions
    if (this.config.requestFeedback) {
      addSection('feedback-request', FEEDBACK_INSTRUCTIONS);
    }

    // Action parameters
    if (action.parameters.length > 0) {
      const paramLines = action.parameters.map((p) =>
        `- **${p.name}**: ${p.description}${p.default != null ? ` (default: ${p.default})` : ''}`,
      );
      addSection('parameters', '## Parameters\n\n' + paramLines.join('\n'));
    }

    return {
      sections,
      totalUnits: queryResult.units.length,
      totalTokensEstimate: totalTokens,
      template: {
        id: `action-${action.id}`,
        sections: sections.map((s) => ({ name: s.name })),
        prioritization: 'relevance',
      },
    };
  }

  private findPurpose(su: ScoredUnit, queryResult: QueryResult): string | null {
    // Simple heuristic: assign to the first retrieval purpose
    // A better implementation would track which retrieval returned which unit
    return queryResult.retrievalResults.length > 0
      ? queryResult.retrievalResults[0].purpose
      : null;
  }

  private evaluateAssertion(expression: string, outputs: Record<string, unknown>): boolean {
    // Simple assertion evaluation — checks if an output exists and is truthy
    // A more sophisticated version would support expressions
    try {
      const [key, op, value] = expression.split(/\s+/);
      if (key && key in outputs) {
        if (!op) return !!outputs[key];
        if (op === '!=') return outputs[key] != value;
        if (op === '==') return String(outputs[key]) === value;
      }
      return !!outputs[Object.keys(outputs)[0]];
    } catch {
      return true; // Fail open on assertion parse errors
    }
  }
}
