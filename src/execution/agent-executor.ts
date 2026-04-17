/**
 * AgentActionExecutor: implements ActionExecutor for agent-type actions.
 *
 * The execution flow:
 * 1. Construct queries from the action definition
 * 2. Execute queries against the knowledge retriever
 * 3. Assemble retrieved knowledge into agent input
 * 4. Invoke the agent (LLM) with complete context
 * 5. If agent requests tool calls, execute them and re-invoke (multi-turn loop)
 * 6. Validate output against schema and other validation criteria
 * 7. Parse response: primary output + structured feedback
 * 8. Record feedback for training data accumulation
 * 9. Return outputs and validation results
 *
 * The agent receives a complete context — resolved inputs, relevant knowledge,
 * instructions, tools — ideally making the initial retrieval sufficient so
 * the agent doesn't need additional queries.
 */

import { v4 as uuidv4 } from 'uuid';
import type { ActionExecutor } from './dag-engine.js';
import type { PlanNode, ValidationResult, Objective } from './plan-dag.js';
import type { ActionDefinition, ActionValidation } from './action-model.js';
import type { Retriever } from '../retrieval/retriever.js';
import type { AgentAdapter, AgentTurn } from '../processing/agent-adapter.js';
import type { ScoredUnit, AssembledInput, AgentOutput } from '../core/types.js';
import {
  QueryConstructor,
  type QueryConstructorConfig,
  type QueryResult,
} from './query-constructor.js';
import {
  parseFeedback,
  extractPrimaryResponse,
  FEEDBACK_INSTRUCTIONS,
  type FeedbackRecord,
  type FeedbackStore,
} from './feedback.js';
import {
  type ToolRegistry,
  type ToolCallResponse,
  type ToolExecutionContext,
} from './tools.js';
import { validateAgainstSchema } from './json-schema.js';

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
  /** Maximum tool call rounds before forcing a final response. Default: 10 */
  maxToolCallRounds: number;
  /** Tool registry for handling tool calls. If not provided, tool calls are ignored. */
  toolRegistry?: ToolRegistry;
}

const DEFAULT_CONFIG: AgentExecutorConfig = {
  maxContextTokens: 8000,
  requestFeedback: true,
  maxToolCallRounds: 10,
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
        objective = await this.objectiveResolver(node.childPlanId).catch(() => null);
      }

      const constructedQuery = this.queryConstructor.construct(
        action,
        objective,
        action.contextId,
        resolvedInputs,
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

      // 4-5. Invoke agent — single-shot or multi-turn with tool calls
      const { finalOutput, turns } = await this.invokeAgentLoop(
        action,
        assembledInput,
        node,
      );

      // 6. Parse feedback from final response
      const primaryResponse = this.config.requestFeedback
        ? extractPrimaryResponse(finalOutput.response)
        : finalOutput.response;

      const feedback = this.config.requestFeedback
        ? parseFeedback(finalOutput.response, action.id, node.id)
        : null;

      // 7. Build outputs
      const outputs: Record<string, unknown> = {
        response: primaryResponse,
        feedback,
      };

      // Map response to declared output ports
      // Try to parse as JSON if action has outputSchema, otherwise use as text
      let structuredOutput: unknown = null;
      if (action.outputSchema) {
        structuredOutput = this.parseStructuredResponse(primaryResponse);
        if (structuredOutput && typeof structuredOutput === 'object') {
          for (const port of action.outputs) {
            const obj = structuredOutput as Record<string, unknown>;
            if (port.name in obj) {
              outputs[port.name] = obj[port.name];
            }
          }
        }
      }
      // Always provide 'response' port as text fallback
      if (!('response' in outputs) || outputs['response'] == null) {
        outputs['response'] = primaryResponse;
      }

      if (finalOutput.acquireHints && finalOutput.acquireHints.length > 0) {
        outputs['__acquireHints'] = finalOutput.acquireHints;
      }
      if (finalOutput.toolCalls && finalOutput.toolCalls.length > 0) {
        outputs['__toolCalls'] = finalOutput.toolCalls;
      }

      // 8. Run validations
      const validationResults = this.runValidations(
        action,
        outputs,
        structuredOutput,
      );

      // 9. Record feedback (now we know the outcome)
      const allValidationsPassed = validationResults.every((vr) => vr.passed);
      if (feedback) {
        const feedbackRecord: FeedbackRecord = {
          id: uuidv4(),
          feedback,
          queryRetrievalSummary: queryResult.retrievalResults,
          actionId: action.id,
          contextId: action.contextId,
          actionOutcome: allValidationsPassed ? 'succeeded' : 'failed',
        };
        await this.feedbackStore.record(feedbackRecord);
      }

      return {
        outputs,
        validationResults,
        executionMeta: {
          queryResult: {
            totalUnitsRetrieved: queryResult.units.length,
            retrievals: queryResult.retrievalResults,
          },
          agentMeta: finalOutput.metadata,
          turnCount: turns.length,
          totalToolCalls: turns.reduce(
            (sum, t) => sum + (t.output.toolCalls?.length ?? 0),
            0,
          ),
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

  // ── Multi-turn agent loop ────────────────────────────────────────────────

  /**
   * Invoke the agent, possibly through multiple turns of tool calls.
   * Returns the final output (no more tool calls) and the conversation history.
   */
  private async invokeAgentLoop(
    action: ActionDefinition,
    input: AssembledInput,
    node: PlanNode,
  ): Promise<{ finalOutput: AgentOutput; turns: AgentTurn[] }> {
    const turns: AgentTurn[] = [];
    let currentOutput = await this.agentAdapter.process(input);

    // If adapter doesn't support multi-turn or no tool calls, return immediately
    if (!this.agentAdapter.processMultiTurn || !this.config.toolRegistry) {
      return { finalOutput: currentOutput, turns };
    }

    let round = 0;
    while (
      currentOutput.toolCalls &&
      currentOutput.toolCalls.length > 0 &&
      round < this.config.maxToolCallRounds
    ) {
      round++;

      // Execute all tool calls for this turn
      const toolResponses: ToolCallResponse[] = [];
      const toolContext: ToolExecutionContext = {
        actionId: action.id,
        contextId: action.contextId,
        nodeId: node.id,
      };

      for (const call of currentOutput.toolCalls) {
        const response = await this.config.toolRegistry.execute(
          {
            id: call.id,
            name: call.name,
            arguments: call.arguments,
          },
          toolContext,
        );
        toolResponses.push(response);
      }

      // Record this turn
      turns.push({ output: currentOutput, toolResponses });

      // Get the available tools list for the next invocation
      const availableTools = this.config.toolRegistry.list();

      // Re-invoke the agent with the tool results
      currentOutput = await this.agentAdapter.processMultiTurn(
        input,
        turns,
        availableTools,
      );
    }

    // Final turn (no more tool calls)
    if (currentOutput.toolCalls && currentOutput.toolCalls.length > 0) {
      // Hit the round limit — append a synthetic note
      currentOutput = {
        ...currentOutput,
        metadata: {
          ...currentOutput.metadata,
          toolCallLimitReached: true,
          maxRounds: this.config.maxToolCallRounds,
        },
      };
    }

    return { finalOutput: currentOutput, turns };
  }

  // ── Validation ───────────────────────────────────────────────────────────

  private runValidations(
    action: ActionDefinition,
    outputs: Record<string, unknown>,
    structuredOutput: unknown,
  ): ValidationResult[] {
    const results: ValidationResult[] = [];

    // 1. Implicit output schema validation (if defined on the action)
    if (action.outputSchema) {
      const target = structuredOutput ?? outputs;
      const result = validateAgainstSchema(target, action.outputSchema);
      results.push({
        validationId: '__output-schema',
        passed: result.valid,
        detail: result.valid
          ? undefined
          : `Output schema validation failed: ${result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
      });
    }

    // 2. Explicit validations
    for (const validation of action.validations) {
      const result = this.runOneValidation(validation, outputs, structuredOutput);
      results.push(result);
    }

    return results;
  }

  private runOneValidation(
    validation: ActionValidation,
    outputs: Record<string, unknown>,
    structuredOutput: unknown,
  ): ValidationResult {
    switch (validation.method) {
      case 'assertion': {
        if (!validation.expression) {
          return { validationId: validation.id, passed: true };
        }
        const passed = this.evaluateAssertion(validation.expression, outputs);
        return {
          validationId: validation.id,
          passed,
          detail: passed ? undefined : `Assertion failed: ${validation.expression}`,
        };
      }

      case 'schema': {
        if (!validation.schema) {
          return { validationId: validation.id, passed: true };
        }
        const target = structuredOutput ?? outputs;
        const result = validateAgainstSchema(target, validation.schema);
        return {
          validationId: validation.id,
          passed: result.valid,
          detail: result.valid
            ? undefined
            : `Schema validation failed: ${result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
        };
      }

      case 'agent-review':
      case 'human-review':
      case 'test':
      case 'delegated':
        // These are handled by the broader execution system, not here.
        // Mark as passed (deferred) — the orchestrator can run them as
        // separate validation actions.
        return {
          validationId: validation.id,
          passed: true,
          detail: `Deferred validation method: ${validation.method}`,
        };

      default:
        return { validationId: validation.id, passed: true };
    }
  }

  private parseStructuredResponse(response: string): unknown {
    // Try to extract a JSON object from the response.
    // Handles fenced code blocks (```json ... ```) and bare JSON.
    const fencedMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const candidates: string[] = [];
    if (fencedMatch) candidates.push(fencedMatch[1]);

    // Try the whole response as JSON
    candidates.push(response.trim());

    // Find the first JSON object in the text
    const objMatch = response.match(/\{[\s\S]*\}/);
    if (objMatch) candidates.push(objMatch[0]);

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Try next candidate
      }
    }

    return null;
  }

  // ── Context Assembly ─────────────────────────────────────────────────────

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

    if (this.config.systemPrompt) {
      addSection('system', this.config.systemPrompt);
    }

    // Action instructions
    const instructionLines: string[] = [
      `## Task: ${action.name}`,
      '',
      action.description,
      '',
      '### Instructions',
      action.instructions,
      '',
      '### Expected Outputs',
      ...action.outputs.map((o) => `- **${o.name}**: ${o.description}`),
    ];

    // If the action has an output schema, include it in instructions
    if (action.outputSchema) {
      instructionLines.push('');
      instructionLines.push('### Output Format');
      instructionLines.push('Your response must include a JSON object matching this schema:');
      instructionLines.push('```json');
      instructionLines.push(JSON.stringify(action.outputSchema, null, 2));
      instructionLines.push('```');
    }

    if (action.validations.length > 0) {
      instructionLines.push('');
      instructionLines.push('### Validation Criteria');
      instructionLines.push(...action.validations.map((v) => `- ${v.description}`));
    }

    addSection('instructions', instructionLines.join('\n'));

    // Resolved inputs from the DAG
    if (Object.keys(resolvedInputs).length > 0) {
      const inputLines = Object.entries(resolvedInputs).map(([key, value]) => {
        const strValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        return `**${key}**:\n${strValue}`;
      });
      addSection('inputs', '## Provided Inputs\n\n' + inputLines.join('\n\n'));
    }

    // Attempt history (for retries)
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

    // Available tools
    if (this.config.toolRegistry && this.agentAdapter.processMultiTurn) {
      const tools = this.config.toolRegistry.list();
      if (tools.length > 0) {
        const toolLines = tools.map((t) =>
          `- **${t.name}**: ${t.description}`,
        );
        addSection(
          'available-tools',
          '## Available Tools\n\nYou may invoke these tools during execution:\n\n' + toolLines.join('\n'),
        );
      }
    }

    if (this.config.requestFeedback) {
      addSection('feedback-request', FEEDBACK_INSTRUCTIONS);
    }

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

  private findPurpose(_su: ScoredUnit, queryResult: QueryResult): string | null {
    return queryResult.retrievalResults.length > 0
      ? queryResult.retrievalResults[0].purpose
      : null;
  }

  private evaluateAssertion(expression: string, outputs: Record<string, unknown>): boolean {
    try {
      const [key, op, value] = expression.split(/\s+/);
      if (key && key in outputs) {
        if (!op) return !!outputs[key];
        if (op === '!=') return outputs[key] != value;
        if (op === '==') return String(outputs[key]) === value;
      }
      return !!outputs[Object.keys(outputs)[0]];
    } catch {
      return true;
    }
  }
}
