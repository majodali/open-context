/**
 * Anthropic agent adapter: sends assembled context to Claude and returns the response.
 *
 * Supports:
 * - Native Anthropic tool-use (tools passed as structured definitions)
 * - Multi-turn tool call loop via processMultiTurn()
 * - Structured output via acquire hints (agent can suggest knowledge to acquire)
 * - Context sufficiency signaling (for metrics)
 * - Configurable model, system prompt, and parameters
 *
 * Tool flow:
 * 1. executor calls process(input, tools) — tools are sent in the API call
 * 2. Claude may emit tool_use blocks in its response
 * 3. executor resolves tool calls, then calls processMultiTurn(input, history, tools)
 * 4. we reconstruct the conversation (user msg, assistant msgs with tool_use,
 *    user msgs with tool_result) and continue the API call
 * 5. repeat until Claude returns without tool calls (final response)
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  AssembledInput,
  AgentOutput,
  AcquireHint,
  ContentType,
} from '../core/types.js';
import type { AgentAdapter, AgentTurn } from './agent-adapter.js';
import type { ToolDefinition } from '../execution/tools.js';

export interface AnthropicAdapterConfig {
  /** Anthropic API key. If not provided, reads from ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Model to use. Default: 'claude-sonnet-4-20250514' */
  model: string;
  /** Maximum output tokens. Default: 4096 */
  maxTokens: number;
  /** System prompt prepended to every request. */
  systemPrompt?: string;
  /** Temperature (0.0–1.0). Default: 0.7 */
  temperature: number;
  /**
   * If true, append instructions asking the agent to provide structured
   * metadata (context sufficiency, acquire hints). Default: true
   * Note: this is legacy metadata. The standard feedback protocol
   * (FEEDBACK_INSTRUCTIONS in the assembled input) is the primary way
   * to capture feedback.
   */
  requestStructuredOutput: boolean;
}

const DEFAULT_CONFIG: AnthropicAdapterConfig = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
  temperature: 0.7,
  requestStructuredOutput: true,
};

const STRUCTURED_OUTPUT_SUFFIX = `

---
After your response, if applicable, please include a section starting with "---METADATA---" containing:
1. CONTEXT_SUFFICIENCY: one of "sufficient", "insufficient", "redundant"
2. ACQUIRE_HINTS: a JSON array of objects with "content", "contentType" (one of: statement, rule, instruction, fact, observation, decision), and optional "tags" array — for any new knowledge that should be stored for future use.

Example:
---METADATA---
CONTEXT_SUFFICIENCY: sufficient
ACQUIRE_HINTS: [{"content": "The auth module uses JWT with RS256", "contentType": "fact", "tags": ["auth", "jwt"]}]
`;

export class AnthropicAgentAdapter implements AgentAdapter {
  private client: Anthropic;
  private config: AnthropicAdapterConfig;

  constructor(config?: Partial<AnthropicAdapterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = new Anthropic({
      apiKey: this.config.apiKey,
    });
  }

  // ── First turn ────────────────────────────────────────────────────────────

  async process(input: AssembledInput, tools?: ToolDefinition[]): Promise<AgentOutput> {
    const userMessage = this.buildInitialUserMessage(input);
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userMessage },
    ];
    return this.invoke(messages, tools);
  }

  // ── Subsequent turns after tool calls ────────────────────────────────────

  async processMultiTurn(
    input: AssembledInput,
    history: AgentTurn[],
    availableTools: ToolDefinition[],
  ): Promise<AgentOutput> {
    const messages = this.buildHistoryMessages(input, history);
    return this.invoke(messages, availableTools);
  }

  // ── Core invocation ──────────────────────────────────────────────────────

  private async invoke(
    messages: Anthropic.MessageParam[],
    tools?: ToolDefinition[],
  ): Promise<AgentOutput> {
    const startTime = Date.now();

    const params: Anthropic.MessageCreateParams = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      messages,
    };

    if (this.config.systemPrompt) {
      params.system = this.config.systemPrompt;
    }

    if (tools && tools.length > 0) {
      params.tools = tools.map(toolDefinitionToAnthropicTool);
    }

    const response = await this.client.messages.create(params);
    const latencyMs = Date.now() - startTime;

    return this.buildAgentOutput(response, latencyMs);
  }

  // ── Message construction ─────────────────────────────────────────────────

  private buildInitialUserMessage(input: AssembledInput): string {
    let userMessage = input.sections.map((s) => s.content).join('\n\n');
    if (this.config.requestStructuredOutput) {
      userMessage += STRUCTURED_OUTPUT_SUFFIX;
    }
    return userMessage;
  }

  /**
   * Reconstruct the conversation message history from the initial input
   * plus prior turns. The resulting array is what we send to the API on
   * continuation turns.
   *
   * Each turn in history represents: the agent's response (with its tool_use
   * blocks) followed by a user message carrying the tool results.
   */
  private buildHistoryMessages(
    input: AssembledInput,
    history: AgentTurn[],
  ): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: this.buildInitialUserMessage(input) },
    ];

    for (const turn of history) {
      const assistantContent: Anthropic.ContentBlockParam[] = [];

      // Original text response
      if (turn.output.response) {
        assistantContent.push({ type: 'text', text: turn.output.response });
      }

      // Tool use blocks
      if (turn.output.toolCalls && turn.output.toolCalls.length > 0) {
        for (const call of turn.output.toolCalls) {
          assistantContent.push({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.arguments,
          });
        }
      }

      if (assistantContent.length > 0) {
        messages.push({ role: 'assistant', content: assistantContent });
      }

      // User message with tool results
      if (turn.toolResponses.length > 0) {
        const userContent: Anthropic.ContentBlockParam[] = turn.toolResponses.map(
          (tr) => ({
            type: 'tool_result',
            tool_use_id: tr.id,
            content: typeof tr.content === 'string'
              ? tr.content
              : JSON.stringify(tr.content),
            is_error: !tr.success,
          }),
        );
        messages.push({ role: 'user', content: userContent });
      }
    }

    return messages;
  }

  // ── Output construction ──────────────────────────────────────────────────

  private buildAgentOutput(
    response: Anthropic.Message,
    latencyMs: number,
  ): AgentOutput {
    // Extract text content
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    const fullResponse = textBlocks.map((b) => b.text).join('');

    // Parse legacy structured metadata (if any)
    const { mainResponse, metadata } = this.parseStructuredOutput(fullResponse);

    // Collect tool_use blocks → ToolCall[]
    const toolBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    const toolCalls = toolBlocks.length > 0
      ? toolBlocks.map((block) => ({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        }))
      : undefined;

    return {
      response: mainResponse,
      metadata: {
        model: response.model,
        latencyMs,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason,
        contextSufficiency: metadata.contextSufficiency,
      },
      acquireHints: metadata.acquireHints,
      toolCalls,
    };
  }

  private parseStructuredOutput(fullResponse: string): {
    mainResponse: string;
    metadata: {
      contextSufficiency?: 'sufficient' | 'insufficient' | 'redundant';
      acquireHints?: AcquireHint[];
    };
  } {
    const metadataSplit = fullResponse.split('---METADATA---');

    if (metadataSplit.length < 2) {
      return { mainResponse: fullResponse.trim(), metadata: {} };
    }

    const mainResponse = metadataSplit[0].trim();
    const metadataSection = metadataSplit[1].trim();

    let contextSufficiency: 'sufficient' | 'insufficient' | 'redundant' | undefined;
    let acquireHints: AcquireHint[] | undefined;

    const sufficiencyMatch = metadataSection.match(
      /CONTEXT_SUFFICIENCY:\s*(sufficient|insufficient|redundant)/i,
    );
    if (sufficiencyMatch) {
      contextSufficiency = sufficiencyMatch[1].toLowerCase() as any;
    }

    const hintsMatch = metadataSection.match(/ACQUIRE_HINTS:\s*(\[[\s\S]*?\])/);
    if (hintsMatch) {
      try {
        const parsed = JSON.parse(hintsMatch[1]);
        if (Array.isArray(parsed)) {
          acquireHints = parsed
            .filter((h: any) => h.content && h.contentType)
            .map((h: any) => ({
              content: String(h.content),
              contentType: h.contentType as ContentType,
              tags: Array.isArray(h.tags) ? h.tags : undefined,
            }));
        }
      } catch {
        // Invalid JSON — skip hints
      }
    }

    return {
      mainResponse,
      metadata: { contextSufficiency, acquireHints },
    };
  }
}

// ---------------------------------------------------------------------------
// Tool definition conversion
// ---------------------------------------------------------------------------

/**
 * Convert an OpenContext ToolDefinition into the Anthropic Tool format.
 */
function toolDefinitionToAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  };
}
