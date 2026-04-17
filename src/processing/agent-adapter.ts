/**
 * Agent adapter: integration boundary for AI agents.
 * OpenContext does NOT implement the agent itself — users provide adapters.
 */

import type { AssembledInput, AgentOutput, PipelineContext } from '../core/types.js';

export interface AgentAdapter {
  process(input: AssembledInput): Promise<AgentOutput>;
}

/**
 * Noop adapter for testing — returns the assembled input as the response.
 */
export class NoopAgentAdapter implements AgentAdapter {
  async process(input: AssembledInput): Promise<AgentOutput> {
    const content = input.sections.map((s) => s.content).join('\n\n');
    return {
      response: `[NoopAgent] Received ${input.totalUnits} units across ${input.sections.length} sections.\n\n${content}`,
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
