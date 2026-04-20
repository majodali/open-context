/**
 * Walkthrough report formatters.
 *
 * Three outputs from a WalkthroughResult:
 * - summary: concise text summary of stats and tier results (for terminals)
 * - markdown: full review-ready document (for human review + storage)
 * - json: full structured result (for programmatic analysis / archives)
 */

import type { WalkthroughResult } from './types.js';
import { formatOrchestrationTrace } from '../execution/trace-formatter.js';

// ---------------------------------------------------------------------------
// Compact summary (one-screen text)
// ---------------------------------------------------------------------------

export function formatWalkthroughSummary(result: WalkthroughResult): string {
  const lines: string[] = [];
  const hr = '─'.repeat(74);

  lines.push(hr);
  lines.push(`Walkthrough: ${result.scenario.name}`);
  lines.push(`  ${result.scenario.description}`);
  lines.push(hr);
  lines.push('');

  // Tier results
  lines.push('Tier Results:');
  lines.push(`  1. Produced output:     ${tierEmoji(result.tiers.producedOutput)} ${boolStr(result.tiers.producedOutput)}`);
  lines.push(`  2. Basic validation:    ${tierEmoji(result.tiers.basicValidation)} ${boolStr(result.tiers.basicValidation)}`);
  lines.push(`  3. Self-reported:       ${sufficiencyStr(result.tiers.selfReportedSufficiency)}`);
  lines.push(`  4. External review:     ${externalReviewStr(result.tiers.externalReview)}`);
  lines.push(`  Overall (expectations): ${tierEmoji(result.tiers.passedExpectations)} ${boolStr(result.tiers.passedExpectations)}`);
  lines.push('');

  // Stats
  lines.push('Stats:');
  lines.push(`  Objectives:    ${result.stats.totalObjectives}`);
  lines.push(`  Actions:       ${result.stats.totalActions}`);
  lines.push(`  Attempts:      ${result.stats.totalAttempts} (${result.stats.failedAttempts} failed)`);
  lines.push(`  Tool calls:    ${result.stats.totalToolCalls}`);
  lines.push(`  Tokens:        ${result.stats.totalTokens.toLocaleString()}`);
  lines.push(`  Feedback:      ${result.feedbackRecords.length} records`);
  lines.push(`  Training data: ${result.trainingExamples.length} examples`);
  lines.push(`  Corpus:        ${result.stats.unitsInCorpus} units in ${result.stats.contextsInCorpus} contexts`);
  lines.push(`  Duration:      ${(result.durationMs / 1000).toFixed(1)}s`);
  lines.push('');

  // Orchestration statuses
  lines.push('Orchestrations:');
  for (const o of result.orchestrations) {
    lines.push(`  - ${o.objective.name}: ${o.status}${o.reason ? ` (${o.reason})` : ''}`);
  }

  return lines.join('\n');
}

function tierEmoji(pass: boolean): string {
  return pass ? '✓' : '✗';
}

function boolStr(v: boolean): string {
  return v ? 'PASS' : 'FAIL';
}

function sufficiencyStr(v: WalkthroughResult['tiers']['selfReportedSufficiency']): string {
  if (v == null) return '○ (no feedback collected)';
  switch (v) {
    case 'sufficient':        return '✓ sufficient';
    case 'mostly-sufficient': return '~ mostly-sufficient';
    case 'insufficient':      return '✗ insufficient';
    case 'excessive':         return '! excessive';
  }
}

function externalReviewStr(
  review: WalkthroughResult['tiers']['externalReview'],
): string {
  if (!review) return '○ (not reviewed)';
  return `${review.overall} (by ${review.reviewedBy})`;
}

// ---------------------------------------------------------------------------
// Full markdown report
// ---------------------------------------------------------------------------

export interface MarkdownReportOptions {
  /** Include the full orchestration trace (possibly verbose). Default: true */
  includeTrace?: boolean;
  /** Include detailed feedback records. Default: true */
  includeFeedback?: boolean;
  /** Include training example summary (not full data). Default: true */
  includeTrainingSummary?: boolean;
  /** Include raw event stream. Default: false (often very long) */
  includeEvents?: boolean;
}

export function formatWalkthroughMarkdown(
  result: WalkthroughResult,
  options?: MarkdownReportOptions,
): string {
  const opts = {
    includeTrace: true,
    includeFeedback: true,
    includeTrainingSummary: true,
    includeEvents: false,
    ...options,
  };
  const lines: string[] = [];

  lines.push(`# Walkthrough: ${result.scenario.name}`);
  lines.push('');
  lines.push(result.scenario.description);
  lines.push('');
  lines.push(`**ID:** \`${result.scenario.id}\``);
  lines.push(`**Started:** ${new Date(result.startedAt).toISOString()}`);
  lines.push(`**Completed:** ${new Date(result.completedAt).toISOString()}`);
  lines.push(`**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`);
  lines.push('');

  // Tier results
  lines.push('## Tier Results');
  lines.push('');
  lines.push('| Tier | Status | Notes |');
  lines.push('|------|--------|-------|');
  lines.push(`| 1. Produced output | ${mdBool(result.tiers.producedOutput)} | — |`);
  lines.push(`| 2. Basic validation | ${mdBool(result.tiers.basicValidation)} | — |`);
  lines.push(`| 3. Self-reported | ${mdSufficiency(result.tiers.selfReportedSufficiency)} | best across feedbacks |`);
  lines.push(`| 4. External review | ${mdExternalReview(result.tiers.externalReview)} | ${result.tiers.externalReview?.overall ?? 'pending'} |`);
  lines.push(`| **Overall (expectations)** | **${mdBool(result.tiers.passedExpectations)}** | — |`);
  lines.push('');

  // Stats
  lines.push('## Stats');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Objectives | ${result.stats.totalObjectives} |`);
  lines.push(`| Actions | ${result.stats.totalActions} |`);
  lines.push(`| Attempts | ${result.stats.totalAttempts} (${result.stats.failedAttempts} failed) |`);
  lines.push(`| Tool calls | ${result.stats.totalToolCalls} |`);
  lines.push(`| Input+output tokens | ${result.stats.totalTokens.toLocaleString()} |`);
  lines.push(`| Feedback records | ${result.feedbackRecords.length} |`);
  lines.push(`| Training examples | ${result.trainingExamples.length} |`);
  lines.push(`| Corpus size | ${result.stats.unitsInCorpus} units / ${result.stats.contextsInCorpus} contexts |`);
  lines.push('');

  // Orchestration summaries
  lines.push('## Orchestrations');
  lines.push('');
  for (const o of result.orchestrations) {
    lines.push(`### ${o.objective.name}`);
    lines.push('');
    lines.push(`**Status:** ${o.status}`);
    if (o.reason) lines.push(`**Reason:** ${o.reason}`);
    lines.push(`**Nodes executed:** ${o.totalNodesExecuted}`);
    lines.push(`**Sub-objectives:** ${o.subObjectives.length}`);
    lines.push('');
    lines.push(`**Description:**`);
    lines.push('> ' + o.objective.description.replace(/\n/g, '\n> '));
    lines.push('');
    if (o.objective.acceptanceCriteria.length > 0) {
      lines.push('**Acceptance criteria:**');
      for (const crit of o.objective.acceptanceCriteria) {
        lines.push(`- ${crit}`);
      }
      lines.push('');
    }
  }

  // Full trace
  if (opts.includeTrace) {
    lines.push('## Execution Trace');
    lines.push('');
    lines.push('```');
    for (const o of result.orchestrations) {
      lines.push(formatOrchestrationTrace(o, { color: false, maxOutputLength: 250 }));
      lines.push('');
    }
    lines.push('```');
    lines.push('');
  }

  // Feedback records
  if (opts.includeFeedback && result.feedbackRecords.length > 0) {
    lines.push('## Agent Feedback');
    lines.push('');
    for (const fb of result.feedbackRecords) {
      lines.push(`### Action: \`${fb.actionId}\` — outcome: ${fb.actionOutcome}`);
      lines.push('');
      lines.push(`- **Context quality:** ${fb.feedback.contextQuality}`);
      lines.push(`- **Used units:** ${fb.feedback.usedUnits.length}`);
      lines.push(`- **Unused units:** ${fb.feedback.unusedUnits.length}`);
      lines.push(`- **Missing information:** ${fb.feedback.missingInformation.length}`);
      lines.push(`- **Subsequent queries:** ${fb.feedback.subsequentQueries.length}`);
      lines.push(`- **Found via follow-up:** ${fb.feedback.foundViaFollowUp.length}`);
      lines.push(`- **Failure to find:** ${fb.feedback.failureToFind.length}`);
      lines.push('');

      if (fb.feedback.missingInformation.length > 0) {
        lines.push('**Missing information:**');
        for (const m of fb.feedback.missingInformation) {
          lines.push(`- (${m.severity}) ${m.description}`);
        }
        lines.push('');
      }
      if (fb.feedback.foundViaFollowUp.length > 0) {
        lines.push('**Found via follow-up** (retrieval miss):');
        for (const f of fb.feedback.foundViaFollowUp) {
          lines.push(`- \`${f.unitId}\` (importance ${f.importance}): ${f.detail ?? 'found via query'}`);
        }
        lines.push('');
      }
      if (fb.feedback.failureToFind.length > 0) {
        lines.push('**Failure to find** (not in KB or retrieval failure):');
        for (const f of fb.feedback.failureToFind) {
          lines.push(`- (${f.severity}, ${f.diagnosis}) ${f.description}`);
        }
        lines.push('');
      }
    }
  }

  // Training data summary
  if (opts.includeTrainingSummary && result.trainingExamples.length > 0) {
    lines.push('## Training Data Generated');
    lines.push('');
    const bySource = new Map<string, number>();
    for (const ex of result.trainingExamples) {
      bySource.set(ex.source, (bySource.get(ex.source) ?? 0) + 1);
    }
    lines.push('| Source | Count |');
    lines.push('|--------|-------|');
    for (const [source, count] of bySource) {
      lines.push(`| ${source} | ${count} |`);
    }
    lines.push('');
    lines.push(`Total examples: ${result.trainingExamples.length}`);
    lines.push('');
  }

  // Events
  if (opts.includeEvents) {
    lines.push('## Event Stream');
    lines.push('');
    lines.push(`Total events: ${result.events.length}`);
    lines.push('');
    lines.push('```');
    for (const e of result.events) {
      lines.push(`[${e.seq}] ${new Date(e.timestamp).toISOString().substring(11, 23)} ${e.type}`);
    }
    lines.push('```');
  }

  // Review section (empty — to be filled by reviewer)
  lines.push('## External Review');
  lines.push('');
  if (result.tiers.externalReview) {
    const r = result.tiers.externalReview;
    lines.push(`**Reviewed by:** ${r.reviewedBy}`);
    lines.push(`**Reviewed at:** ${new Date(r.reviewedAt).toISOString()}`);
    lines.push(`**Overall:** ${r.overall}`);
    lines.push('');
    lines.push(`**Output quality:** ${r.outputQuality.assessment}`);
    lines.push('> ' + r.outputQuality.notes.replace(/\n/g, '\n> '));
    lines.push('');

    if (r.retrievalQuality) {
      lines.push('### Retrieval Quality');
      lines.push('');
      lines.push(`- **Valuable retrieved:** ${r.retrievalQuality.valuableRetrieved.length}`);
      lines.push(`- **Valuable missed:** ${r.retrievalQuality.valuableMissed.length}`);
      lines.push(`- **Non-valuable retrieved:** ${r.retrievalQuality.nonValuableRetrieved.length}`);
      lines.push('');
      if (r.retrievalQuality.tagSuggestions.length > 0) {
        lines.push('**Tag suggestions:**');
        for (const ts of r.retrievalQuality.tagSuggestions) {
          lines.push(`- \`${ts.tag}\` → apply to ${ts.applyTo.length} units`);
          lines.push(`  - _rationale:_ ${ts.rationale}`);
        }
        lines.push('');
      }
      lines.push('> ' + r.retrievalQuality.notes.replace(/\n/g, '\n> '));
      lines.push('');
    }

    if (r.processObservations && r.processObservations.length > 0) {
      lines.push('### Process Observations');
      for (const obs of r.processObservations) {
        lines.push(`- ${obs}`);
      }
      lines.push('');
    }
  } else {
    lines.push('_Not yet reviewed._');
    lines.push('');
    lines.push('Fill in this section with:');
    lines.push('- Overall quality assessment');
    lines.push('- Retrieval quality review (valuable retrieved / missed / noise)');
    lines.push('- Tag suggestions for units that should have matched');
    lines.push('- Process observations');
    lines.push('');
  }

  return lines.join('\n');
}

function mdBool(v: boolean): string {
  return v ? '✅ pass' : '❌ fail';
}

function mdSufficiency(
  v: WalkthroughResult['tiers']['selfReportedSufficiency'],
): string {
  if (v == null) return '⚪ no feedback';
  switch (v) {
    case 'sufficient':        return '✅ sufficient';
    case 'mostly-sufficient': return '🟡 mostly-sufficient';
    case 'insufficient':      return '❌ insufficient';
    case 'excessive':         return '⚠️ excessive';
  }
}

function mdExternalReview(
  v: WalkthroughResult['tiers']['externalReview'],
): string {
  if (!v) return '⚪ pending';
  const emoji = {
    excellent: '✅',
    good: '✅',
    acceptable: '🟡',
    poor: '❌',
    failed: '❌',
  }[v.overall];
  return `${emoji} ${v.overall}`;
}

// ---------------------------------------------------------------------------
// JSON serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a walkthrough result to JSON.
 * Handles the Map inside orchestration results (meta-plan.nodes).
 */
export function walkthroughToJson(result: WalkthroughResult, pretty = true): string {
  const replacer = (_key: string, value: unknown) => {
    if (value instanceof Map) {
      return Object.fromEntries(value.entries());
    }
    return value;
  };
  return JSON.stringify(result, replacer, pretty ? 2 : undefined);
}
