/**
 * Agent adapter: integration boundary for AI agents.
 * OpenContext does NOT implement the agent itself — users provide adapters.
 *
 * Supports two modes:
 * - Single-shot: process() returns one response.
 * - Multi-turn: processMultiTurn() supports a tool call loop, where the
 *   agent can request tool invocations and continue from the results.
 *   Required for actions whose performer needs tool access.
 */

import type { AssembledInput, AgentOutput, PipelineContext, ToolCall } from '../core/types.js';
import type { ToolDefinition, ToolCallResponse } from '../execution/tools.js';

export interface AgentAdapter {
  /**
   * Process assembled input and return a response.
   * If `tools` is provided, the adapter should make them available to the
   * agent so it can request tool calls in its output. Returned tool calls
   * are resolved by the executor and passed to processMultiTurn() to continue.
   */
  process(input: AssembledInput, tools?: ToolDefinition[]): Promise<AgentOutput>;

  /**
   * Continue an in-progress conversation after tool calls have been resolved.
   * Receives the original input, the history of previous turns (each with
   * the agent's output and the resolved tool responses), and the current
   * set of available tools.
   *
   * Optional — adapters that don't support tool calls can omit this.
   * If absent, the executor treats the initial process() response as final.
   */
  processMultiTurn?(
    input: AssembledInput,
    history: AgentTurn[],
    availableTools: ToolDefinition[],
  ): Promise<AgentOutput>;
}

/**
 * One turn in a multi-turn agent conversation.
 */
export interface AgentTurn {
  /** The agent's output for this turn (response + any tool calls). */
  output: AgentOutput;
  /** Resolved tool call results for this turn (empty if no tool calls). */
  toolResponses: ToolCallResponse[];
}

/**
 * Noop adapter for testing — returns the assembled input as the response.
 */
export class NoopAgentAdapter implements AgentAdapter {
  async process(input: AssembledInput, tools?: ToolDefinition[]): Promise<AgentOutput> {
    const content = input.sections.map((s) => s.content).join('\n\n');
    const toolNote = tools && tools.length > 0
      ? ` (${tools.length} tools available but not used)`
      : '';
    return {
      response: `[NoopAgent] Received ${input.totalUnits} units across ${input.sections.length} sections${toolNote}.\n\n${content}`,
      metadata: {
        adapter: 'noop',
        tokensEstimate: input.totalTokensEstimate,
      },
    };
  }
}

/**
 * Pipeline step handler for agent processing.
 */
export function createProcessStep(adapter: AgentAdapter) {
  return async (ctx: PipelineContext): Promise<PipelineContext> => {
    if (!ctx.assembledInput) return ctx;

    ctx.agentOutput = await adapter.process(ctx.assembledInput);
    ctx.stepResults['process'] = {
      responseLength: ctx.agentOutput.response.length,
      toolCalls: ctx.agentOutput.toolCalls?.length ?? 0,
    };
    return ctx;
  };
}
