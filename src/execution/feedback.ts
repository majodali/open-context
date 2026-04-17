/**
 * Structured Feedback Protocol
 *
 * Every agent invocation produces structured feedback about the quality
 * of its input context. This is not optional instrumentation — it's a
 * required part of the action execution protocol.
 *
 * Feedback serves two purposes:
 * 1. Immediate: informs curation about what to improve in action definitions
 * 2. Long-term: accumulates training data for a learned retrieval model
 *
 * The agent's instructions should include a standard requirement to provide
 * this feedback, and the executor parses it from the agent's response.
 */

// ---------------------------------------------------------------------------
// Execution Feedback (from agent after execution)
// ---------------------------------------------------------------------------

/**
 * Structured feedback from an agent about its execution context.
 * Returned alongside the agent's primary output.
 */
export interface ExecutionFeedback {
  /** ID of the action that was executed. */
  actionId: string;
  /** ID of the plan node, if part of a plan. */
  nodeId?: string;
  /** Timestamp. */
  timestamp: number;

  // -- Context quality --

  /**
   * Overall assessment of the provided context.
   * - sufficient: had everything needed
   * - mostly-sufficient: minor gaps that didn't block execution
   * - insufficient: significant gaps that impacted quality
   * - excessive: too much irrelevant information, hard to find what mattered
   */
  contextQuality: 'sufficient' | 'mostly-sufficient' | 'insufficient' | 'excessive';

  // -- Unit-level feedback --

  /** Units that were directly used in producing the output. */
  usedUnits: UnitUsageFeedback[];
  /** Units that were provided but not relevant. */
  unusedUnits: UnusedUnitFeedback[];

  // -- Missing information --

  /** Information the agent needed but wasn't provided. */
  missingInformation: MissingInfo[];

  // -- Additional queries --

  /** If the agent performed additional knowledge queries. */
  additionalQueries: AdditionalQueryFeedback[];

  // -- Action definition feedback --

  /** Feedback on the action definition itself. */
  actionFeedback?: ActionDefinitionFeedback;
}

/**
 * Feedback on a specific unit that was used.
 */
export interface UnitUsageFeedback {
  unitId: string;
  /** How it was used. */
  usage: 'directly-applied' | 'informed-reasoning' | 'provided-context' | 'used-as-reference';
  /** How important was this unit (0-1). */
  importance: number;
  /** Brief explanation. */
  detail?: string;
}

/**
 * Feedback on a unit that was provided but not used.
 */
export interface UnusedUnitFeedback {
  unitId: string;
  /** Why it wasn't useful. */
  reason: 'irrelevant' | 'redundant' | 'too-detailed' | 'too-abstract' | 'outdated' | 'wrong-context';
  detail?: string;
}

/**
 * Information the agent needed but wasn't provided.
 */
export interface MissingInfo {
  /** What was missing. */
  description: string;
  /** How critical was it. */
  severity: 'blocking' | 'degraded-quality' | 'minor-inconvenience';
  /** Where the agent eventually found it (if anywhere). */
  resolution?: 'found-via-query' | 'inferred' | 'asked-user' | 'worked-around' | 'unresolved';
}

/**
 * Feedback on an additional query the agent performed.
 */
export interface AdditionalQueryFeedback {
  /** What the agent searched for. */
  query: string;
  /** Why it was needed. */
  reason: string;
  /** Whether it returned useful results. */
  effective: boolean;
  /** How many useful units were found. */
  usefulUnitsFound: number;
  detail?: string;
}

/**
 * Feedback on the action definition itself.
 */
export interface ActionDefinitionFeedback {
  /** Were the instructions clear and complete? */
  instructionQuality: 'clear' | 'mostly-clear' | 'ambiguous' | 'incomplete';
  /** Were the input port definitions accurate? */
  inputAccuracy: 'accurate' | 'mostly-accurate' | 'inaccurate';
  /** Were the output port definitions accurate? */
  outputAccuracy: 'accurate' | 'mostly-accurate' | 'inaccurate';
  /** Specific suggestions for improving the action definition. */
  suggestions: string[];
}

// ---------------------------------------------------------------------------
// Feedback Storage
// ---------------------------------------------------------------------------

/**
 * Stored feedback record — ties execution feedback to a specific run
 * for training data accumulation.
 */
export interface FeedbackRecord {
  id: string;
  /** The execution feedback. */
  feedback: ExecutionFeedback;
  /** Query result that produced the context (for training data pairing). */
  queryRetrievalSummary: {
    purpose: string;
    query: string;
    unitsReturned: number;
  }[];
  /** The action definition used. */
  actionId: string;
  /** The context this was executed in. */
  contextId: string;
  /** Outcome of the action (success/failure). */
  actionOutcome: 'succeeded' | 'failed';
}

export interface FeedbackStore {
  record(feedback: FeedbackRecord): Promise<void>;
  getByAction(actionId: string, limit?: number): Promise<FeedbackRecord[]>;
  getByContext(contextId: string, limit?: number): Promise<FeedbackRecord[]>;
  getAll(limit?: number): Promise<FeedbackRecord[]>;
  clear(): Promise<void>;
}

export class InMemoryFeedbackStore implements FeedbackStore {
  private records: FeedbackRecord[] = [];

  async record(feedback: FeedbackRecord): Promise<void> {
    this.records.push(feedback);
  }

  async getByAction(actionId: string, limit?: number): Promise<FeedbackRecord[]> {
    const filtered = this.records.filter((r) => r.actionId === actionId);
    return limit ? filtered.slice(-limit) : filtered;
  }

  async getByContext(contextId: string, limit?: number): Promise<FeedbackRecord[]> {
    const filtered = this.records.filter((r) => r.contextId === contextId);
    return limit ? filtered.slice(-limit) : filtered;
  }

  async getAll(limit?: number): Promise<FeedbackRecord[]> {
    return limit ? this.records.slice(-limit) : [...this.records];
  }

  async clear(): Promise<void> {
    this.records = [];
  }
}

// ---------------------------------------------------------------------------
// Feedback instructions (appended to agent prompts)
// ---------------------------------------------------------------------------

/**
 * Standard instructions appended to agent prompts requesting structured feedback.
 * The agent should include this in its response for the executor to parse.
 */
export const FEEDBACK_INSTRUCTIONS = `
After completing your primary task, provide execution feedback in a JSON block marked with ---FEEDBACK---. This is required for every response.

---FEEDBACK---
{
  "contextQuality": "sufficient|mostly-sufficient|insufficient|excessive",
  "usedUnits": [{"unitId": "...", "usage": "directly-applied|informed-reasoning|provided-context|used-as-reference", "importance": 0.0-1.0, "detail": "..."}],
  "unusedUnits": [{"unitId": "...", "reason": "irrelevant|redundant|too-detailed|too-abstract|outdated|wrong-context"}],
  "missingInformation": [{"description": "...", "severity": "blocking|degraded-quality|minor-inconvenience", "resolution": "found-via-query|inferred|asked-user|worked-around|unresolved"}],
  "additionalQueries": [{"query": "...", "reason": "...", "effective": true|false, "usefulUnitsFound": 0}],
  "actionFeedback": {"instructionQuality": "clear|mostly-clear|ambiguous|incomplete", "inputAccuracy": "accurate|mostly-accurate|inaccurate", "outputAccuracy": "accurate|mostly-accurate|inaccurate", "suggestions": ["..."]}
}
`;

/**
 * Parse feedback from an agent response.
 * Returns null if no feedback block is found.
 */
export function parseFeedback(
  response: string,
  actionId: string,
  nodeId?: string,
): ExecutionFeedback | null {
  const marker = '---FEEDBACK---';
  const idx = response.indexOf(marker);
  if (idx === -1) return null;

  const afterMarker = response.substring(idx + marker.length).trim();

  // Find the JSON block
  const jsonStart = afterMarker.indexOf('{');
  if (jsonStart === -1) return null;

  // Find matching closing brace
  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < afterMarker.length; i++) {
    if (afterMarker[i] === '{') depth++;
    if (afterMarker[i] === '}') depth--;
    if (depth === 0) {
      jsonEnd = i + 1;
      break;
    }
  }
  if (jsonEnd === -1) return null;

  try {
    const parsed = JSON.parse(afterMarker.substring(jsonStart, jsonEnd));
    return {
      actionId,
      nodeId,
      timestamp: Date.now(),
      contextQuality: parsed.contextQuality ?? 'sufficient',
      usedUnits: parsed.usedUnits ?? [],
      unusedUnits: parsed.unusedUnits ?? [],
      missingInformation: parsed.missingInformation ?? [],
      additionalQueries: parsed.additionalQueries ?? [],
      actionFeedback: parsed.actionFeedback,
    };
  } catch {
    return null;
  }
}

/**
 * Extract the primary response (everything before the feedback marker).
 */
export function extractPrimaryResponse(response: string): string {
  const marker = '---FEEDBACK---';
  const idx = response.indexOf(marker);
  if (idx === -1) return response.trim();
  return response.substring(0, idx).trim();
}
