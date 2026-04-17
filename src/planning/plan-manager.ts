/**
 * PlanManager: creates, evaluates, and revises plans.
 *
 * The planning-learning cycle:
 * 1. createPlan() — define activities, expectations, and hypotheses
 * 2. (execute work through the normal pipeline)
 * 3. evaluate() — compare execution against plan, produce learnings
 * 4. revisePlan() — apply learnings to update the plan
 * 5. Repeat
 */

import { v4 as uuidv4 } from 'uuid';
import type { SemanticUnit, AcquireOptions } from '../core/types.js';
import type { UnitStore } from '../storage/unit-store.js';
import type { MetricsStore } from '../metrics/metrics-store.js';
import type { AcquisitionDeps } from '../acquisition/acquire.js';
import { acquireContent } from '../acquisition/acquire.js';
import type {
  Plan,
  ActivityPlan,
  Expectation,
  Hypothesis,
  EvaluationResult,
  ActivityEvaluationResult,
  ExpectationResult,
  HypothesisResult,
  PlanRevision,
  MaturityLevel,
  HypothesisStatus,
} from './types.js';
import type {
  RunRecord,
  RetrieveTelemetry,
  AssembleTelemetry,
  ProcessTelemetry,
} from '../metrics/types.js';

export class PlanManager {
  constructor(
    private unitStore: UnitStore,
    private metricsStore: MetricsStore,
  ) {}

  // ── Plan CRUD ──────────────────────────────────────────────────────────

  /**
   * Create a plan and store it as a semantic unit.
   */
  async createPlan(
    plan: Plan,
    deps: AcquisitionDeps,
  ): Promise<SemanticUnit[]> {
    const content = JSON.stringify(plan, null, 2);
    return acquireContent(content, plan.contextId, deps, {
      sourceType: 'system',
      contentType: 'plan',
      tags: ['plan', `plan:${plan.name}`, `maturity:${plan.maturity}`],
      mutability: 'assertion',
    });
  }

  /**
   * Retrieve the current (latest non-superseded) plan for a context.
   */
  async getPlan(contextId: string): Promise<Plan | null> {
    const units = await this.unitStore.getByContext(contextId);
    const planUnits = units.filter((u) => u.metadata.contentType === 'plan');

    // Find superseded IDs
    const supersededIds = new Set<string>();
    for (const u of planUnits) {
      if (u.metadata.supersedes) supersededIds.add(u.metadata.supersedes);
    }

    // Get the latest non-superseded plan
    const active = planUnits
      .filter((u) => !supersededIds.has(u.id))
      .sort((a, b) => b.metadata.updatedAt - a.metadata.updatedAt);

    if (active.length === 0) return null;

    try {
      return JSON.parse(active[0].content) as Plan;
    } catch {
      return null;
    }
  }

  // ── Evaluation ─────────────────────────────────────────────────────────

  /**
   * Evaluate recent runs against the plan for a context.
   * Produces structured learnings.
   */
  async evaluate(
    contextId: string,
    options?: { maxRuns?: number; sinceTimestamp?: number },
  ): Promise<EvaluationResult | null> {
    const plan = await this.getPlan(contextId);
    if (!plan) return null;

    // Get relevant runs
    let runs = await this.metricsStore.getRunsByContext(contextId);
    if (options?.sinceTimestamp) {
      runs = runs.filter((r) => r.timestamp >= options.sinceTimestamp!);
    }
    if (options?.maxRuns) {
      runs = runs.slice(0, options.maxRuns);
    }
    if (runs.length === 0) return null;

    // Evaluate each activity
    const activityResults: ActivityEvaluationResult[] = [];

    for (const activity of plan.activities) {
      const result = this.evaluateActivity(activity, runs);
      activityResults.push(result);
    }

    // Generate suggested revisions
    const suggestedRevisions = this.generateRevisions(activityResults, plan);

    // Build summary
    const summary = this.buildSummary(activityResults, runs.length);

    // Find plan unit ID for reference
    const planUnits = (await this.unitStore.getByContext(contextId))
      .filter((u) => u.metadata.contentType === 'plan');
    const planId = planUnits.length > 0 ? planUnits[planUnits.length - 1].id : 'unknown';

    return {
      planId,
      contextId,
      evaluatedAt: Date.now(),
      runIds: runs.map((r) => r.runId),
      activityResults,
      summary,
      suggestedRevisions,
    };
  }

  /**
   * Store an evaluation result as a learning unit.
   */
  async storeLearning(
    evaluation: EvaluationResult,
    deps: AcquisitionDeps,
  ): Promise<SemanticUnit[]> {
    // Store the structured evaluation as a record
    const structuredContent = JSON.stringify(evaluation, null, 2);
    const structuredUnits = await acquireContent(
      structuredContent,
      evaluation.contextId,
      deps,
      {
        sourceType: 'system',
        contentType: 'learning',
        tags: ['learning', 'evaluation', `runs:${evaluation.runIds.length}`],
        mutability: 'record',
      },
    );

    // Also store the human-readable summary as a queryable assertion
    if (evaluation.summary) {
      const summaryUnits = await acquireContent(
        evaluation.summary,
        evaluation.contextId,
        deps,
        {
          sourceType: 'system',
          contentType: 'insight',
          tags: ['learning-summary', 'evaluation'],
          mutability: 'assertion',
        },
      );
      structuredUnits.push(...summaryUnits);
    }

    return structuredUnits;
  }

  // ── Plan Revision ──────────────────────────────────────────────────────

  /**
   * Apply revisions to a plan and store the updated version.
   * The old plan unit is superseded by the new one.
   */
  async revisePlan(
    contextId: string,
    revisions: PlanRevision[],
    deps: AcquisitionDeps,
  ): Promise<SemanticUnit[] | null> {
    const plan = await this.getPlan(contextId);
    if (!plan) return null;

    // Find the current plan unit to supersede
    const planUnits = (await this.unitStore.getByContext(contextId))
      .filter((u) => u.metadata.contentType === 'plan')
      .sort((a, b) => b.metadata.updatedAt - a.metadata.updatedAt);
    const currentPlanUnitId = planUnits.length > 0 ? planUnits[0].id : undefined;

    // Apply revisions
    const revised = this.applyRevisions(plan, revisions);
    revised.revision++;
    revised.previousRevision = currentPlanUnitId;

    // Store new plan
    const newUnits = await acquireContent(
      JSON.stringify(revised, null, 2),
      contextId,
      deps,
      {
        sourceType: 'system',
        contentType: 'plan',
        tags: ['plan', `plan:${revised.name}`, `maturity:${revised.maturity}`, `revision:${revised.revision}`],
        mutability: 'assertion',
      },
    );

    // Mark old plan as superseded
    if (currentPlanUnitId && newUnits.length > 0) {
      await this.unitStore.update(newUnits[0].id, {
        metadata: {
          ...newUnits[0].metadata,
          supersedes: currentPlanUnitId,
        },
      });
    }

    return newUnits;
  }

  // ── Private: Activity Evaluation ───────────────────────────────────────

  private evaluateActivity(
    activity: ActivityPlan,
    runs: RunRecord[],
  ): ActivityEvaluationResult {
    const expectationResults = activity.expectations.map((exp) =>
      this.evaluateExpectation(exp, runs),
    );

    const hypothesisResults = activity.hypotheses.map((hyp) =>
      this.evaluateHypothesis(hyp, runs),
    );

    const observations: string[] = [];

    // Check if maturity should change
    let suggestedMaturity: MaturityLevel | undefined;

    if (activity.maturity === 'experimental') {
      const testedHypotheses = hypothesisResults.filter(
        (h) => h.newStatus === 'validated' || h.newStatus === 'invalidated',
      );
      if (testedHypotheses.length > 0) {
        observations.push(
          `${testedHypotheses.length} hypotheses now have results — consider moving to 'emerging'.`,
        );
        suggestedMaturity = 'emerging';
      }
    }

    if (activity.maturity === 'emerging') {
      const metExpectations = expectationResults.filter((e) => e.met);
      if (expectationResults.length >= 3 && metExpectations.length === expectationResults.length) {
        observations.push(
          `All ${expectationResults.length} expectations consistently met — consider moving to 'established'.`,
        );
        suggestedMaturity = 'established';
      }
    }

    if (activity.maturity === 'established') {
      const missedExpectations = expectationResults.filter((e) => !e.withinTolerance);
      if (missedExpectations.length > 0) {
        observations.push(
          `${missedExpectations.length} expectations missed beyond tolerance — investigate or revise baselines.`,
        );
      }
    }

    return {
      activityId: activity.id,
      activityName: activity.name,
      maturity: activity.maturity,
      expectationResults,
      hypothesisResults,
      suggestedMaturity,
      observations,
    };
  }

  private evaluateExpectation(
    expectation: Expectation,
    runs: RunRecord[],
  ): ExpectationResult {
    const actualValue = this.extractMetric(expectation.metric, runs);

    let met: boolean;
    switch (expectation.operator) {
      case 'gt': met = actualValue > expectation.value; break;
      case 'gte': met = actualValue >= expectation.value; break;
      case 'lt': met = actualValue < expectation.value; break;
      case 'lte': met = actualValue <= expectation.value; break;
      case 'eq': met = Math.abs(actualValue - expectation.value) < 0.001; break;
      case 'between':
        met = actualValue >= expectation.value && actualValue <= (expectation.upperValue ?? Infinity);
        break;
      default: met = false;
    }

    const deviation = expectation.value !== 0
      ? (actualValue - expectation.value) / expectation.value
      : 0;

    return {
      expectationId: expectation.id,
      metric: expectation.metric,
      expectedValue: expectation.value,
      actualValue,
      met,
      deviation,
      withinTolerance: Math.abs(deviation) <= expectation.tolerance,
    };
  }

  private evaluateHypothesis(
    hypothesis: Hypothesis,
    runs: RunRecord[],
  ): HypothesisResult {
    const observationCount = runs.length;
    let newStatus: HypothesisStatus = hypothesis.status;
    let evidence = '';

    if (observationCount < hypothesis.minObservations) {
      if (hypothesis.status === 'untested') {
        newStatus = 'testing';
        evidence = `${observationCount}/${hypothesis.minObservations} observations collected. Need more data.`;
      } else {
        evidence = `Still collecting data: ${observationCount}/${hypothesis.minObservations}.`;
      }
    } else {
      // Enough observations — hypothesis evaluation needs to be done by the
      // curation agent with full context. We flag it as ready for evaluation.
      if (hypothesis.status === 'untested' || hypothesis.status === 'testing') {
        newStatus = 'testing'; // Ready for agent evaluation
        evidence = `${observationCount} observations available (>= ${hypothesis.minObservations} minimum). Ready for evaluation.`;
      }
    }

    return {
      hypothesisId: hypothesis.id,
      statement: hypothesis.statement,
      previousStatus: hypothesis.status,
      newStatus,
      observationCount,
      evidence,
    };
  }

  // ── Private: Metric Extraction ─────────────────────────────────────────

  private extractMetric(metric: string, runs: RunRecord[]): number {
    if (runs.length === 0) return 0;

    switch (metric) {
      case 'successRate': {
        const withOutcomes = runs.filter((r) => r.outcome);
        if (withOutcomes.length === 0) return 0;
        return withOutcomes.filter((r) => r.outcome!.success).length / withOutcomes.length;
      }

      case 'averageQuality': {
        const withOutcomes = runs.filter((r) => r.outcome);
        if (withOutcomes.length === 0) return 0;
        return withOutcomes.reduce((s, r) => s + r.outcome!.quality, 0) / withOutcomes.length;
      }

      case 'averageRetrievalScore': {
        const scores: number[] = [];
        for (const run of runs) {
          const step = run.steps.find((s) => s.stepType === 'retrieve');
          if (step?.details.type === 'retrieve') {
            scores.push(step.details.scoreDistribution.mean);
          }
        }
        return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      }

      case 'averageDurationMs': {
        return runs.reduce((s, r) => s + r.totalDurationMs, 0) / runs.length;
      }

      case 'tokenUtilization': {
        const utils: number[] = [];
        for (const run of runs) {
          const step = run.steps.find((s) => s.stepType === 'assemble');
          if (step?.details.type === 'assemble') {
            utils.push(step.details.tokenUtilization);
          }
        }
        return utils.length > 0 ? utils.reduce((a, b) => a + b, 0) / utils.length : 0;
      }

      case 'unitsRetrieved': {
        return runs.reduce((s, r) => s + r.unitsRetrieved, 0) / runs.length;
      }

      case 'errorRate': {
        let totalSteps = 0;
        let errors = 0;
        for (const run of runs) {
          for (const step of run.steps) {
            totalSteps++;
            if (step.status === 'error') errors++;
          }
        }
        return totalSteps > 0 ? errors / totalSteps : 0;
      }

      default:
        return 0;
    }
  }

  // ── Private: Revision Generation ───────────────────────────────────────

  private generateRevisions(
    activityResults: ActivityEvaluationResult[],
    plan: Plan,
  ): PlanRevision[] {
    const revisions: PlanRevision[] = [];

    for (const result of activityResults) {
      // Suggest maturity changes
      if (result.suggestedMaturity && result.suggestedMaturity !== result.maturity) {
        revisions.push({
          type: 'change-maturity',
          activityId: result.activityId,
          description: `Change maturity from '${result.maturity}' to '${result.suggestedMaturity}' for '${result.activityName}'.`,
          detail: {
            from: result.maturity,
            to: result.suggestedMaturity,
          },
        });
      }

      // Suggest expectation updates for consistently missed baselines
      for (const er of result.expectationResults) {
        if (!er.withinTolerance && !er.met) {
          revisions.push({
            type: 'update-expectation',
            activityId: result.activityId,
            description: `Expectation '${er.metric}' consistently not met (expected ${er.expectedValue}, actual ${er.actualValue.toFixed(3)}). Consider adjusting the baseline or investigating the cause.`,
            detail: {
              expectationId: er.expectationId,
              expectedValue: er.expectedValue,
              actualValue: er.actualValue,
              deviation: er.deviation,
            },
          });
        }
      }

      // Flag hypotheses ready for evaluation
      for (const hr of result.hypothesisResults) {
        if (hr.previousStatus !== hr.newStatus) {
          revisions.push({
            type: 'update-hypothesis-status',
            activityId: result.activityId,
            description: `Hypothesis '${hr.statement}' status changed: ${hr.previousStatus} → ${hr.newStatus}. ${hr.evidence}`,
            detail: {
              hypothesisId: hr.hypothesisId,
              from: hr.previousStatus,
              to: hr.newStatus,
              evidence: hr.evidence,
            },
          });
        }
      }
    }

    return revisions;
  }

  private applyRevisions(plan: Plan, revisions: PlanRevision[]): Plan {
    const revised = JSON.parse(JSON.stringify(plan)) as Plan;

    for (const revision of revisions) {
      const activity = revised.activities.find((a) => a.id === revision.activityId);
      if (!activity) continue;

      switch (revision.type) {
        case 'change-maturity':
          activity.maturity = revision.detail['to'] as MaturityLevel;
          break;

        case 'update-expectation': {
          const exp = activity.expectations.find(
            (e) => e.id === revision.detail['expectationId'],
          );
          if (exp && revision.detail['newValue'] != null) {
            exp.value = revision.detail['newValue'] as number;
          }
          break;
        }

        case 'update-hypothesis-status': {
          const hyp = activity.hypotheses.find(
            (h) => h.id === revision.detail['hypothesisId'],
          );
          if (hyp) {
            hyp.status = revision.detail['to'] as HypothesisStatus;
            if (revision.detail['evidence']) {
              hyp.evidence = revision.detail['evidence'] as string;
            }
          }
          break;
        }

        case 'add-expectation':
          if (revision.detail['expectation']) {
            activity.expectations.push(revision.detail['expectation'] as Expectation);
          }
          break;

        case 'add-hypothesis':
          if (revision.detail['hypothesis']) {
            activity.hypotheses.push(revision.detail['hypothesis'] as Hypothesis);
          }
          break;

        case 'retire-hypothesis': {
          const idx = activity.hypotheses.findIndex(
            (h) => h.id === revision.detail['hypothesisId'],
          );
          if (idx >= 0) activity.hypotheses.splice(idx, 1);
          break;
        }

        // restructure, add-activity, remove-activity are handled by the caller
        // since they may require creating new contexts
      }
    }

    return revised;
  }

  // ── Private: Summary ───────────────────────────────────────────────────

  private buildSummary(results: ActivityEvaluationResult[], runCount: number): string {
    const parts: string[] = [];
    parts.push(`Evaluation of ${results.length} activities across ${runCount} runs.`);

    for (const r of results) {
      const metCount = r.expectationResults.filter((e) => e.met).length;
      const totalExp = r.expectationResults.length;
      const hypothesesReady = r.hypothesisResults.filter(
        (h) => h.newStatus === 'testing' && h.observationCount >= 0,
      ).length;

      let actSummary = `${r.activityName} (${r.maturity})`;
      if (totalExp > 0) {
        actSummary += `: ${metCount}/${totalExp} expectations met`;
      }
      if (hypothesesReady > 0) {
        actSummary += `, ${hypothesesReady} hypotheses ready for evaluation`;
      }
      if (r.suggestedMaturity) {
        actSummary += ` — suggest maturity change to '${r.suggestedMaturity}'`;
      }
      if (r.observations.length > 0) {
        actSummary += `. ${r.observations.join(' ')}`;
      }
      parts.push(actSummary);
    }

    return parts.join(' ');
  }
}
