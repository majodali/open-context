/**
 * Triage: examines agent output and determines what to feed back into the knowledge store.
 */

import type {
  PipelineContext,
  OutcomeSignal,
  AcquireHint,
} from '../core/types.js';
import { acquireContent, type AcquisitionDeps } from '../acquisition/acquire.js';

export interface TriageConfig {
  /** Automatically acquire agent response as new knowledge. */
  acquireResponses: boolean;
  /** Automatically acquire tool call results. */
  acquireToolResults: boolean;
  /** Record outcome signals for retrieved units. */
  recordOutcomes: boolean;
}

const DEFAULT_TRIAGE_CONFIG: TriageConfig = {
  acquireResponses: false,
  acquireToolResults: true,
  recordOutcomes: true,
};

/**
 * Pipeline step handler for triage.
 */
export function createTriageStep(
  acquisitionDeps: AcquisitionDeps,
  config?: Partial<TriageConfig>,
) {
  const cfg = { ...DEFAULT_TRIAGE_CONFIG, ...config };

  return async (ctx: PipelineContext): Promise<PipelineContext> => {
    if (!ctx.agentOutput) return ctx;

    const triageResults: Record<string, unknown> = {};

    // 1. Process acquire hints from the agent
    if (ctx.agentOutput.acquireHints) {
      const hintUnits = [];
      for (const hint of ctx.agentOutput.acquireHints) {
        const units = await acquireContent(
          hint.content,
          ctx.input.contextId,
          acquisitionDeps,
          {
            sourceType: 'agent',
            contentType: hint.contentType,
            tags: hint.tags,
          },
        );
        hintUnits.push(...units);
      }
      ctx.acquiredUnits.push(...hintUnits);
      triageResults['acquireHints'] = hintUnits.length;
    }

    // 2. Optionally acquire the agent's response
    if (cfg.acquireResponses && ctx.agentOutput.response) {
      const units = await acquireContent(
        ctx.agentOutput.response,
        ctx.input.contextId,
        acquisitionDeps,
        { sourceType: 'agent' },
      );
      ctx.acquiredUnits.push(...units);
      triageResults['acquiredResponse'] = units.length;
    }

    // 3. Optionally acquire tool call results
    if (cfg.acquireToolResults && ctx.agentOutput.toolCalls) {
      for (const tc of ctx.agentOutput.toolCalls) {
        if (tc.result != null) {
          const resultStr = typeof tc.result === 'string'
            ? tc.result
            : JSON.stringify(tc.result);
          const units = await acquireContent(
            resultStr,
            ctx.input.contextId,
            acquisitionDeps,
            { sourceType: 'tool', tags: [`tool:${tc.name}`] },
          );
          ctx.acquiredUnits.push(...units);
        }
      }
      triageResults['acquiredToolResults'] = ctx.agentOutput.toolCalls.length;
    }

    // 4. Record outcome signals for retrieved units
    if (cfg.recordOutcomes && ctx.retrievedUnits.length > 0) {
      const signal: OutcomeSignal = {
        timestamp: Date.now(),
        type: 'neutral', // Can be upgraded to positive/negative based on agent feedback
        source: 'triage',
        detail: `Agent processed with ${ctx.agentOutput.response.length} char response`,
      };
      for (const su of ctx.retrievedUnits) {
        await acquisitionDeps.unitStore.recordUsage(su.unit.id, 'inclusion', signal);
      }
      triageResults['outcomesRecorded'] = ctx.retrievedUnits.length;
    }

    ctx.stepResults['triage'] = triageResults;
    return ctx;
  };
}
