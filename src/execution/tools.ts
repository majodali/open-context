/**
 * Tool Registry
 *
 * Tools are functions that agents can invoke during execution. Each tool has
 * a name, description, JSON schema for its inputs, and an executor function.
 *
 * Tools enable interaction with the world during agent execution: querying
 * additional knowledge, modifying resources, requesting user input, calling
 * external APIs, etc.
 *
 * Standard tools provided by OpenContext:
 * - request_user_input: ask the user/caller for information
 * - additional standard tools can be registered as needed
 */

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

/**
 * Definition of a tool that an agent can call.
 */
export interface ToolDefinition {
  /** Unique tool name. Used by agents to invoke. */
  name: string;
  /** Human-readable description of what the tool does. */
  description: string;
  /**
   * JSON Schema for the tool's input parameters.
   * The agent provides arguments matching this schema when invoking.
   */
  inputSchema: Record<string, unknown>;
  /** The function that executes the tool. */
  execute: ToolExecutor;
  /** Tags for tool classification. */
  tags?: string[];
}

/**
 * Function signature for tool execution.
 * Receives parsed arguments, returns a result that will be appended to
 * the agent's context.
 */
export type ToolExecutor = (
  args: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<ToolResult>;

export interface ToolExecutionContext {
  /** The action being executed when this tool was called. */
  actionId: string;
  /** The bounded context the action is in. */
  contextId: string;
  /** The plan node, if applicable. */
  nodeId?: string;
  /** Custom context data passed by the caller. */
  custom?: Record<string, unknown>;
}

export interface ToolResult {
  /** Whether the tool call succeeded. */
  success: boolean;
  /** Result content — appended to the agent's conversation. */
  content: string | unknown;
  /** Optional structured metadata. */
  metadata?: Record<string, unknown>;
  /** Error message if success is false. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Tool Call (request from agent)
// ---------------------------------------------------------------------------

export interface ToolCallRequest {
  /** Unique ID for this tool call (for matching with results). */
  id: string;
  /** Name of the tool to invoke. */
  name: string;
  /** Arguments matching the tool's input schema. */
  arguments: Record<string, unknown>;
}

export interface ToolCallResponse {
  /** Matches the request ID. */
  id: string;
  /** Whether the tool call succeeded. */
  success: boolean;
  /** Result content. */
  content: string | unknown;
  /** Error if failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /** Register a tool. Throws if a tool with the same name already exists. */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Replace an existing tool, or register if not present. */
  registerOrReplace(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /** Unregister a tool by name. */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /** Get a tool by name. */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** List all registered tools. */
  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Execute a tool call. */
  async execute(
    request: ToolCallRequest,
    context: ToolExecutionContext,
  ): Promise<ToolCallResponse> {
    const tool = this.tools.get(request.name);
    if (!tool) {
      return {
        id: request.id,
        success: false,
        content: '',
        error: `Tool '${request.name}' is not registered`,
      };
    }

    try {
      const result = await tool.execute(request.arguments, context);
      return {
        id: request.id,
        success: result.success,
        content: result.content,
        error: result.error,
      };
    } catch (err) {
      return {
        id: request.id,
        success: false,
        content: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Standard Tools
// ---------------------------------------------------------------------------

/**
 * Configuration for the user-input tool.
 */
export interface UserInputHandler {
  /**
   * Called when an agent invokes the user-input tool.
   * Returns the user's response.
   *
   * For headless/automated mode, implementations may return a default,
   * skip with a documented response, or throw if user input is required.
   */
  request(question: string, context: ToolExecutionContext): Promise<string>;
}

/**
 * Create the standard request_user_input tool.
 * The handler implementation determines how the question reaches the user.
 */
export function createUserInputTool(handler: UserInputHandler): ToolDefinition {
  return {
    name: 'request_user_input',
    description:
      'Ask the user (or calling system) for information needed to proceed. ' +
      'Use this when the action cannot be completed without additional clarification ' +
      'or input that is not available in the current context.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question or request to present to the user.',
        },
        context: {
          type: 'string',
          description: 'Optional context explaining why the question is being asked.',
        },
      },
      required: ['question'],
    },
    execute: async (args, ctx) => {
      const question = String(args['question'] ?? '');
      if (!question) {
        return {
          success: false,
          content: '',
          error: 'No question provided',
        };
      }
      try {
        const fullPrompt = args['context']
          ? `${args['context']}\n\n${question}`
          : question;
        const response = await handler.request(fullPrompt, ctx);
        return {
          success: true,
          content: response,
        };
      } catch (err) {
        return {
          success: false,
          content: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    tags: ['standard', 'interaction'],
  };
}

/**
 * A user input handler that returns a default response without prompting.
 * Useful for automated/headless mode where the system should proceed
 * with documented assumptions rather than block.
 */
export class DefaultResponseUserInputHandler implements UserInputHandler {
  constructor(private defaultResponse: string = 'No user input available — proceed with reasonable assumptions.') {}

  async request(_question: string): Promise<string> {
    return this.defaultResponse;
  }
}

/**
 * A user input handler that throws — useful when user input is required
 * but no human is available. Forces the orchestrator to escalate.
 */
export class StrictUserInputHandler implements UserInputHandler {
  async request(question: string): Promise<string> {
    throw new Error(`User input required but no handler available: "${question}"`);
  }
}

/**
 * A user input handler that records questions and returns a queued response.
 * Useful for testing — pre-load responses, then verify questions match.
 */
export class QueuedUserInputHandler implements UserInputHandler {
  readonly questions: string[] = [];

  constructor(private responses: string[] = []) {}

  queue(response: string): void {
    this.responses.push(response);
  }

  async request(question: string): Promise<string> {
    this.questions.push(question);
    if (this.responses.length === 0) {
      throw new Error(`No queued response for question: "${question}"`);
    }
    return this.responses.shift()!;
  }
}
