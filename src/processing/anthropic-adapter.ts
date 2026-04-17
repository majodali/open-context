/**
 * Anthropic agent adapter: sends assembled context to Claude and returns the response.
 *
 * Supports:
 * - Structured output via acquire hints (agent can suggest knowledge to acquire)
 * - Tool use (agent can request tool calls)
 * - Context sufficiency signaling (for metrics)
 * - Configurable model, system prompt, and parameters
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  AssembledInput,
  AgentOutput,
  AcquireHint,
  ToolCall,
  ContentType,
} from '../core/types.js';
import type { AgentAdapter } from './agent-adapter.js';

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
   * feedback about context sufficiency and knowledge acquisition hints.
   * Default: true
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

  async process(input: AssembledInput): Promise<AgentOutput> {
    // Build the user message from assembled sections
    let userMessage = input.sections.map((s) => s.content).join('\n\n');

    if (this.config.requestStructuredOutput) {
      userMessage += STRUCTURED_OUTPUT_SUFFIX;
    }

    const startTime = Date.now();

    const params: Anthropic.MessageCreateParams = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      messages: [
        { role: 'user', content: userMessage },
      ],
    };

    if (this.config.systemPrompt) {
      params.system = this.config.systemPrompt;
    }

    const response = await this.client.messages.create(params);

    const latencyMs = Date.now() - startTime;

    // Extract text content
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    const fullResponse = textBlocks.map((b) => b.text).join('');

    // Parse structured output if present
    const { mainResponse, metadata } = this.parseStructuredOutput(fullResponse);

    // Build agent output
    const output: AgentOutput = {
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
    };

    // Handle tool use blocks
    const toolBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (toolBlocks.length > 0) {
      output.toolCalls = toolBlocks.map((block) => ({
        id: block.id,
        name: block.name,
        arguments: block.input as Record<string, unknown>,
      }));
    }

    return output;
  }

  /**
   * Parse the structured metadata section from the response.
   */
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

    // Parse CONTEXT_SUFFICIENCY
    const sufficiencyMatch = metadataSection.match(
      /CONTEXT_SUFFICIENCY:\s*(sufficient|insufficient|redundant)/i,
    );
    if (sufficiencyMatch) {
      contextSufficiency = sufficiencyMatch[1].toLowerCase() as any;
    }

    // Parse ACQUIRE_HINTS
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
