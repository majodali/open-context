/**
 * Trace Formatter
 *
 * Converts an OrchestrationResult into a human-readable execution trace.
 * Used for post-run inspection: "what happened during this orchestration?"
 *
 * The output is structured, indented text designed to be read by a human
 * in a terminal or log viewer. For machine-readable traces, walk the
 * OrchestrationResult and AttemptRecord structures directly.
 */

import type { OrchestrationResult } from './orchestrator.js';
import type { PlanDAG, PlanNode, AttemptRecord } from './plan-dag.js';
import type { ExecutionEvent } from './events.js';

// ---------------------------------------------------------------------------
// Formatting options
// ---------------------------------------------------------------------------

export interface TraceFormatOptions {
  /** Indent string per level. Default: '  ' */
  indent: string;
  /** Maximum output string length before truncation. Default: 200 */
  maxOutputLength: number;
  /** Whether to include full action descriptions. Default: true */
  includeActionDescriptions: boolean;
  /** Whether to include query/retrieval details. Default: true */
  includeQueryDetails: boolean;
  /** Whether to include failed attempts. Default: true */
  includeFailedAttempts: boolean;
  /** Whether to include validation results. Default: true */
  includeValidations: boolean;
  /** Whether to use ANSI color codes. Default: true */
  color: boolean;
}

const DEFAULT_OPTIONS: TraceFormatOptions = {
  indent: '  ',
  maxOutputLength: 200,
  includeActionDescriptions: true,
  includeQueryDetails: true,
  includeFailedAttempts: true,
  includeValidations: true,
  color: true,
};

// ---------------------------------------------------------------------------
// ANSI colors (minimal — no external dependency)
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatOrchestrationTrace(
  result: OrchestrationResult,
  options?: Partial<TraceFormatOptions>,
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];
  formatResult(result, lines, 0, opts);
  return lines.join('\n');
}

function formatResult(
  result: OrchestrationResult,
  lines: string[],
  depth: number,
  opts: TraceFormatOptions,
): void {
  const prefix = opts.indent.repeat(depth);
  const c = (str: string, color: string) => (opts.color ? `${color}${str}${RESET}` : str);

  // Objective header
  const statusColor = statusToColor(result.status);
  const statusBadge = c(` [${result.status.toUpperCase()}] `, statusColor);

  lines.push('');
  lines.push(`${prefix}${c('OBJECTIVE:', BOLD)} ${result.objective.name}${statusBadge}`);
  lines.push(`${prefix}${c('id:', DIM)} ${result.objective.id}`);
  lines.push(`${prefix}${c('description:', DIM)} ${truncate(result.objective.description, opts.maxOutputLength)}`);

  if (result.objective.acceptanceCriteria.length > 0) {
    lines.push(`${prefix}${c('acceptance criteria:', DIM)}`);
    for (const crit of result.objective.acceptanceCriteria) {
      lines.push(`${prefix}${opts.indent}- ${crit}`);
    }
  }

  if (result.reason) {
    lines.push(`${prefix}${c('reason:', DIM)} ${c(result.reason, YELLOW)}`);
  }

  lines.push(`${prefix}${c('nodes executed:', DIM)} ${result.totalNodesExecuted}`);

  // Meta-plan execution
  if (result.metaPlan.nodes.size > 0) {
    lines.push('');
    lines.push(`${prefix}${c('META-PLAN', BOLD)} ${c(`(${result.metaPlan.id})`, DIM)}`);
    formatPlan(result.metaPlan, lines, depth + 1, opts);
  }

  // Sub-objectives (recursively)
  if (result.subObjectives.length > 0) {
    lines.push('');
    lines.push(`${prefix}${c(`SUB-OBJECTIVES (${result.subObjectives.length}):`, BOLD)}`);
    for (const sub of result.subObjectives) {
      formatResult(sub, lines, depth + 1, opts);
    }
  }
}

function formatPlan(
  plan: PlanDAG,
  lines: string[],
  depth: number,
  opts: TraceFormatOptions,
): void {
  const prefix = opts.indent.repeat(depth);
  const c = (str: string, color: string) => (opts.color ? `${color}${str}${RESET}` : str);

  // Compute execution order by finding when each node completed
  const nodesInOrder = [...plan.nodes.values()].sort((a, b) => {
    const aTime = a.attempts[a.attempts.length - 1]?.startedAt ?? Infinity;
    const bTime = b.attempts[b.attempts.length - 1]?.startedAt ?? Infinity;
    return aTime - bTime;
  });

  for (const node of nodesInOrder) {
    formatNode(node, lines, depth, opts);
  }
}

function formatNode(
  node: PlanNode,
  lines: string[],
  depth: number,
  opts: TraceFormatOptions,
): void {
  const prefix = opts.indent.repeat(depth);
  const c = (str: string, color: string) => (opts.color ? `${color}${str}${RESET}` : str);
  const action = node.action;

  const statusColor = nodeStatusToColor(node.status);
  const statusStr = c(`[${node.status}]`, statusColor);

  lines.push('');
  lines.push(`${prefix}${c('▸', CYAN)} ${c(action?.name ?? node.actionId, BOLD)} ${statusStr}`);

  if (opts.includeActionDescriptions && action?.description) {
    lines.push(`${prefix}${opts.indent}${c('purpose:', DIM)} ${truncate(action.description, opts.maxOutputLength)}`);
  }

  // Attempts
  const attemptsToShow = opts.includeFailedAttempts
    ? node.attempts
    : node.attempts.filter((a) => a.status === 'succeeded');

  for (const attempt of attemptsToShow) {
    formatAttempt(attempt, lines, depth + 1, opts, node);
  }

  if (node.attempts.length === 0 && node.status === 'pending') {
    lines.push(`${prefix}${opts.indent}${c('(did not execute — inputs not available)', DIM)}`);
  }
}

function formatAttempt(
  attempt: AttemptRecord,
  lines: string[],
  depth: number,
  opts: TraceFormatOptions,
  node: PlanNode,
): void {
  const prefix = opts.indent.repeat(depth);
  const c = (str: string, color: string) => (opts.color ? `${color}${str}${RESET}` : str);

  const durationMs = attempt.completedAt
    ? attempt.completedAt - attempt.startedAt
    : null;
  const durationStr = durationMs != null ? `${durationMs}ms` : 'unfinished';

  const attemptHeader = node.attempts.length > 1
    ? `attempt ${attempt.attemptNumber}/${node.attempts.length}`
    : 'attempt';

  const statusColor =
    attempt.status === 'succeeded' ? GREEN :
    attempt.status === 'failed' ? RED :
    attempt.status === 'interrupted' ? YELLOW :
    DIM;

  lines.push(
    `${prefix}${c(attemptHeader, DIM)} ${c(attempt.status, statusColor)} ${c(`(${durationStr})`, DIM)}`,
  );

  // Error
  if (attempt.error) {
    lines.push(`${prefix}${opts.indent}${c('error:', RED)} ${truncate(attempt.error, opts.maxOutputLength)}`);
  }

  // Interrupted
  if (attempt.triggeredRiskIndicator) {
    lines.push(
      `${prefix}${opts.indent}${c('interrupted by:', YELLOW)} ${attempt.triggeredRiskIndicator}`,
    );
  }

  // Query details from executionMeta
  if (opts.includeQueryDetails && attempt.executionMeta) {
    const meta = attempt.executionMeta;
    const queryResult = meta['queryResult'] as any;
    if (queryResult) {
      lines.push(
        `${prefix}${opts.indent}${c('retrieved:', DIM)} ${queryResult.totalUnitsRetrieved} units`,
      );
      if (queryResult.retrievals) {
        for (const r of queryResult.retrievals) {
          lines.push(
            `${prefix}${opts.indent.repeat(2)}${c(r.purpose, MAGENTA)}: ${r.unitsReturned} units`,
          );
        }
      }
    }
    if (meta['turnCount'] != null && (meta['turnCount'] as number) > 0) {
      lines.push(
        `${prefix}${opts.indent}${c('tool-call turns:', DIM)} ${meta['turnCount']} (${meta['totalToolCalls']} calls)`,
      );
    }
    const feedbackSummary = meta['feedbackSummary'] as any;
    if (feedbackSummary) {
      const fb = feedbackSummary;
      lines.push(
        `${prefix}${opts.indent}${c('feedback:', DIM)} context=${fb.contextQuality}, used=${fb.usedUnits}, unused=${fb.unusedUnits}, missing=${fb.missingInfo}`,
      );
    }
  }

  // Outputs (key-preview form)
  if (attempt.status === 'succeeded' && Object.keys(attempt.outputs).length > 0) {
    lines.push(`${prefix}${opts.indent}${c('outputs:', DIM)}`);
    for (const [key, value] of Object.entries(attempt.outputs)) {
      if (key.startsWith('__')) continue; // skip metadata keys
      const preview = formatValue(value, opts.maxOutputLength);
      lines.push(`${prefix}${opts.indent.repeat(2)}${c(key, BLUE)}: ${preview}`);
    }
  }

  // Validations
  if (opts.includeValidations && attempt.validationResults.length > 0) {
    const passed = attempt.validationResults.filter((v) => v.passed).length;
    const failed = attempt.validationResults.filter((v) => !v.passed).length;
    if (failed > 0 || passed > 0) {
      const summary = failed === 0
        ? c(`validations: ${passed}/${passed} passed`, GREEN)
        : c(`validations: ${passed} passed, ${failed} FAILED`, RED);
      lines.push(`${prefix}${opts.indent}${summary}`);
      for (const vr of attempt.validationResults) {
        if (!vr.passed) {
          lines.push(
            `${prefix}${opts.indent.repeat(2)}${c('✗', RED)} ${vr.validationId}: ${truncate(vr.detail ?? '', opts.maxOutputLength)}`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Event stream formatter (for live events)
// ---------------------------------------------------------------------------

/**
 * Create an event handler that formats each event as a single-line log entry
 * and writes it to the provided output (defaults to console.log).
 */
export function createLiveEventLogger(options?: {
  out?: (line: string) => void;
  color?: boolean;
  indentByDepth?: boolean;
}) {
  const out = options?.out ?? console.log;
  const color = options?.color ?? true;
  const indentByDepth = options?.indentByDepth ?? true;
  const c = (str: string, col: string) => (color ? `${col}${str}${RESET}` : str);

  const depthByObjective = new Map<string, number>();

  return (event: ExecutionEvent) => {
    const ts = new Date(event.timestamp).toISOString().substring(11, 23);
    const prefix = `${c(ts, DIM)} `;

    let indent = '';
    let line = '';

    switch (event.type) {
      case 'orchestration.started':
        depthByObjective.set(event.objective.id, event.depth);
        indent = indentByDepth ? '  '.repeat(event.depth) : '';
        line = `${indent}${c('▶ ORCHESTRATE', BOLD + CYAN)} ${event.objective.name} ${c(`(depth ${event.depth})`, DIM)}`;
        break;

      case 'orchestration.completed': {
        const depth = depthByObjective.get(event.objectiveId) ?? 0;
        indent = indentByDepth ? '  '.repeat(depth) : '';
        const col = statusToColor(event.status);
        line = `${indent}${c('■ DONE', BOLD + col)} ${event.objectiveId} ${c(`[${event.status}]`, col)} ${c(`(${event.totalNodesExecuted} nodes)`, DIM)}`;
        if (event.reason) line += ` ${c(event.reason, YELLOW)}`;
        depthByObjective.delete(event.objectiveId);
        break;
      }

      case 'plan.started':
        line = `  ${c('▸ plan', DIM)} ${event.planId} ${c(`(${event.nodeCount} nodes)`, DIM)}`;
        break;

      case 'plan.completed':
        line = `  ${c('◂ plan', DIM)} ${event.planId} ${c(`[${event.status}] ${event.durationMs}ms`, DIM)}`;
        break;

      case 'node.started':
        line = `    ${c('→', CYAN)} ${event.actionName} ${c(`(attempt ${event.attemptNumber})`, DIM)}`;
        break;

      case 'node.attempt':
        line = `    ${c('↻ retry', YELLOW)} ${event.nodeId} ${c(`(attempt ${event.attemptNumber})`, DIM)}${event.previousError ? ' ' + c(`— prev: ${truncate(event.previousError, 60)}`, DIM) : ''}`;
        break;

      case 'node.completed':
        line = `    ${c('✓', GREEN)} ${event.actionId} ${c(`${event.durationMs}ms (${event.validationsPassed} validations)`, DIM)}`;
        break;

      case 'node.failed':
        line = `    ${c('✗', RED)} ${event.actionId} ${c(`— ${truncate(event.error, 80)}`, RED)}${event.willRetry ? c(' (will retry)', YELLOW) : ''}`;
        break;

      case 'node.interrupted':
        line = `    ${c('⏸ interrupted', YELLOW)} ${event.nodeId} ${c(`(${event.riskIndicatorId})`, DIM)}`;
        break;

      case 'subobjective.spawned':
        line = `      ${c('↳ sub-objective', MAGENTA)} ${event.subObjectiveId}: ${truncate(event.subObjectiveDescription, 80)}`;
        break;

      case 'tool.call':
        line = `      ${c('⚙ tool', BLUE)} ${event.toolName}${event.success === false ? c(' FAILED', RED) : ''}`;
        break;

      case 'query':
        line = `      ${c('? query', MAGENTA)} ${event.purpose}: ${event.unitsReturned} units`;
        break;
    }

    if (line) out(prefix + line);
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(str: string, maxLength: number): string {
  if (!str) return '';
  const normalized = str.replace(/\n/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.substring(0, maxLength - 3) + '...';
}

function formatValue(value: unknown, maxLength: number): string {
  if (value == null) return '(null)';
  if (typeof value === 'string') return truncate(value, maxLength);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[array of ${value.length}]`;
  if (typeof value === 'object') {
    try {
      return truncate(JSON.stringify(value), maxLength);
    } catch {
      return '[object]';
    }
  }
  return String(value);
}

function statusToColor(status: string): string {
  switch (status) {
    case 'completed': return GREEN;
    case 'failed': return RED;
    case 'blocked': return YELLOW;
    case 'cycle-detected': return YELLOW;
    case 'depth-limit-reached': return YELLOW;
    default: return DIM;
  }
}

function nodeStatusToColor(status: string): string {
  switch (status) {
    case 'completed': return GREEN;
    case 'failed': return RED;
    case 'interrupted': return YELLOW;
    case 'executing': return CYAN;
    case 'ready': return BLUE;
    case 'skipped': return DIM;
    default: return DIM;
  }
}
