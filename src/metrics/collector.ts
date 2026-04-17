/**
 * MetricsCollector: non-invasively wraps pipeline execution to capture telemetry.
 *
 * The collector wraps step handlers to capture timing, then reads from
 * ctx.stepResults (which steps already populate) to build structured telemetry.
 * Existing step handlers don't need to change.
 */

import { v4 as uuidv4 } from 'uuid';
import type { StepConfig, PipelineContext, PipelineInput, PipelineOutput } from '../core/types.js';
import { Pipeline } from '../core/pipeline.js';
import type { MetricsStore } from './metrics-store.js';
import type {
  StepTelemetry,
  StepTelemetryDetails,
  RunRecord,
  RunOutcome,
  ScoreDistribution,
} from './types.js';

export class MetricsCollector {
  private currentRunTelemetry: StepTelemetry[] = [];

  constructor(private metricsStore: MetricsStore) {}

  /**
   * Wrap a step handler to capture timing and structured telemetry.
   * Returns a new StepConfig with the instrumented handler.
   */
  instrumentStep(step: StepConfig): StepConfig {
    const collector = this;
    const originalHandler = step.handler;

    return {
      ...step,
      handler: async (ctx: PipelineContext): Promise<PipelineContext> => {
        const startedAt = Date.now();
        let status: StepTelemetry['status'] = 'success';
        let error: string | undefined;

        try {
          const result = await originalHandler(ctx);
          return result;
        } catch (err) {
          status = 'error';
          error = err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          const completedAt = Date.now();
          const stepResults = ctx.stepResults[step.id] as Record<string, unknown> | undefined;

          const telemetry: StepTelemetry = {
            stepId: step.id,
            stepType: step.type,
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            status,
            error,
            details: collector.extractDetails(step.type, stepResults, ctx),
          };

          collector.currentRunTelemetry.push(telemetry);
        }
      },
    };
  }

  /**
   * Instrument all steps in a pipeline.
   */
  instrumentPipeline(pipeline: Pipeline): void {
    const steps = pipeline.listSteps();
    for (const step of steps) {
      pipeline.replaceStep(step.id, this.instrumentStep(step));
    }
  }

  /**
   * Execute an instrumented pipeline run, capturing a full RunRecord.
   */
  async instrumentedRun(
    pipeline: Pipeline,
    input: PipelineInput,
    profile?: string,
  ): Promise<PipelineOutput & { runId: string }> {
    const runId = uuidv4();
    const timestamp = Date.now();
    this.currentRunTelemetry = [];

    const output = await pipeline.run(input, profile);

    const completedAt = Date.now();

    const record: RunRecord = {
      runId,
      timestamp,
      input,
      profile: profile ?? input.profile ?? 'full',
      steps: [...this.currentRunTelemetry],
      totalDurationMs: completedAt - timestamp,
      unitsAcquired: output.acquiredUnits.length,
      unitsRetrieved: output.retrievedUnits.length,
      unitsAssembled: this.extractAssembledCount(output),
      unitIdsRetrieved: output.retrievedUnits.map((su) => su.unit.id),
      unitIdsAssembled: this.extractAssembledUnitIds(output),
      contextId: input.contextId,
    };

    await this.metricsStore.recordRun(record);
    this.currentRunTelemetry = [];

    return { ...output, runId };
  }

  /**
   * Report an outcome against a previous run.
   */
  async reportOutcome(outcome: RunOutcome): Promise<void> {
    await this.metricsStore.recordOutcome(outcome);
  }

  /**
   * Extract step-specific telemetry details from stepResults.
   * This reads the data that step handlers already put into ctx.stepResults.
   */
  private extractDetails(
    stepType: string,
    stepResults: Record<string, unknown> | undefined,
    ctx: PipelineContext,
  ): StepTelemetryDetails {
    if (!stepResults) {
      return { type: 'generic' };
    }

    switch (stepType) {
      case 'acquire':
        return {
          type: 'acquire',
          chunksProduced: (stepResults['unitsCreated'] as number) ?? 0,
          classificationsAssigned: (stepResults['classifications'] as any[]) ?? [],
          embeddingLatencyMs: (stepResults['embeddingLatencyMs'] as number) ?? 0,
          nearDuplicatesDetected: (stepResults['nearDuplicatesDetected'] as number) ?? 0,
        };

      case 'retrieve': {
        const scores = ctx.retrievedUnits.map((su) => su.score);
        return {
          type: 'retrieve',
          queryEmbeddingLatencyMs: (stepResults['queryEmbeddingLatencyMs'] as number) ?? 0,
          candidatesScanned: (stepResults['candidatesScanned'] as number) ?? 0,
          candidatesAfterScopeFilter: (stepResults['candidatesAfterScopeFilter'] as number) ?? 0,
          candidatesAfterContentFilter: (stepResults['candidatesAfterContentFilter'] as number) ?? 0,
          resultsReturned: (stepResults['unitsFound'] as number) ?? 0,
          scoreDistribution: this.computeScoreDistribution(scores),
          scopesSearched: (stepResults['scopeMetrics'] as any[]) ?? [],
          emptyScopes: (stepResults['emptyScopes'] as string[]) ?? [],
        };
      }

      case 'assemble':
        return {
          type: 'assemble',
          tokenBudget: (stepResults['tokenBudget'] as number) ?? Infinity,
          tokensUsed: (stepResults['tokensEstimate'] as number) ?? 0,
          tokenUtilization: (stepResults['tokenUtilization'] as number) ?? 0,
          unitsIncluded: (stepResults['totalUnits'] as number) ?? 0,
          unitsExcludedByBudget: (stepResults['unitsExcludedByBudget'] as number) ?? 0,
          sectionsPopulated: (stepResults['sections'] as number) ?? 0,
          sectionsEmpty: (stepResults['sectionsEmpty'] as number) ?? 0,
          unitIds: (stepResults['unitIds'] as string[]) ?? [],
        };

      case 'process':
        return {
          type: 'process',
          latencyMs: (stepResults['latencyMs'] as number) ?? 0,
          inputTokens: stepResults['inputTokens'] as number | undefined,
          outputTokens: stepResults['outputTokens'] as number | undefined,
          toolCallCount: (stepResults['toolCalls'] as number) ?? 0,
          contextSufficiency: stepResults['contextSufficiency'] as any,
        };

      case 'triage':
        return {
          type: 'triage',
          unitsAcquiredFromResponse: (stepResults['acquiredResponse'] as number) ?? 0,
          unitsAcquiredFromTools: (stepResults['acquiredToolResults'] as number) ?? 0,
          unitsAcquiredFromHints: (stepResults['acquireHints'] as number) ?? 0,
          outcomesRecorded: (stepResults['outcomesRecorded'] as number) ?? 0,
        };

      default:
        return { type: 'generic', ...stepResults };
    }
  }

  private computeScoreDistribution(scores: number[]): ScoreDistribution {
    if (scores.length === 0) {
      return { min: 0, max: 0, median: 0, mean: 0 };
    }
    const sorted = [...scores].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mid = Math.floor(sorted.length / 2);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      median: sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid],
      mean: sum / sorted.length,
    };
  }

  private extractAssembledCount(output: PipelineOutput): number {
    const stepResults = output.meta['stepResults'] as Record<string, any> | undefined;
    return stepResults?.['assemble']?.['totalUnits'] ?? 0;
  }

  private extractAssembledUnitIds(output: PipelineOutput): string[] {
    const stepResults = output.meta['stepResults'] as Record<string, any> | undefined;
    return stepResults?.['assemble']?.['unitIds'] ?? [];
  }
}
