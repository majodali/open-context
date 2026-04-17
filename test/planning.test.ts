import { describe, it, expect } from 'vitest';
import {
  OpenContext,
  DeterministicEmbedder,
} from '../src/index.js';
import type {
  Plan,
  RunOutcome,
} from '../src/index.js';

describe('Planning and Learning cycle', () => {
  async function setupWithPlan() {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });

    const root = await oc.createContext({
      name: 'Project',
      description: 'Test project',
    });
    const auth = await oc.createContext({
      name: 'Auth',
      description: 'Authentication',
      parentId: root.id,
    });

    // Seed and add some knowledge
    await oc.acquire('Use JWT tokens with RS256.', auth.id);
    await oc.acquire('All endpoints require auth.', auth.id);

    // Create a plan
    const plan: Plan = {
      contextId: auth.id,
      name: 'Auth Module Plan',
      description: 'Plan for the authentication module',
      maturity: 'emerging',
      activities: [
        {
          id: 'token-validation',
          name: 'Token Validation',
          description: 'Validate JWT tokens on every request',
          maturity: 'established',
          expectations: [
            {
              id: 'exp-quality',
              metric: 'averageQuality',
              description: 'Response quality should be above 0.6',
              operator: 'gte',
              value: 0.6,
              tolerance: 0.1,
            },
            {
              id: 'exp-retrieval',
              metric: 'averageRetrievalScore',
              description: 'Retrieval should find relevant auth content',
              operator: 'gte',
              value: 0.3,
              tolerance: 0.15,
            },
          ],
          hypotheses: [],
        },
        {
          id: 'session-management',
          name: 'Session Management',
          description: 'Manage user sessions and refresh tokens',
          maturity: 'experimental',
          expectations: [],
          hypotheses: [
            {
              id: 'hyp-refresh',
              statement: 'Separating refresh token logic into its own context will improve retrieval quality',
              validationCriteria: 'Retrieval score improves by >10% after separation',
              invalidationCriteria: 'No improvement or retrieval score drops',
              minObservations: 5,
              status: 'untested',
            },
          ],
          evaluationStrategy: 'Run at least 5 queries about session management before evaluating',
        },
      ],
      revision: 1,
    };

    await oc.createPlan(plan);

    return { oc, root, auth, plan };
  }

  it('creates and retrieves a plan', async () => {
    const { oc, auth } = await setupWithPlan();

    const retrieved = await oc.getPlan(auth.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe('Auth Module Plan');
    expect(retrieved!.activities).toHaveLength(2);
    expect(retrieved!.activities[0].maturity).toBe('established');
    expect(retrieved!.activities[1].maturity).toBe('experimental');
  });

  it('evaluates runs against plan expectations', async () => {
    const { oc, auth } = await setupWithPlan();

    // Run some pipeline cycles and report outcomes
    for (let i = 0; i < 4; i++) {
      const output = await oc.run({
        query: `How do I validate tokens? Query ${i}`,
        contextId: auth.id,
        profile: 'retrieve-and-process',
      });
      await oc.reportOutcome({
        runId: output.runId,
        reportedAt: Date.now(),
        reportedBy: 'test',
        success: true,
        quality: 0.65 + i * 0.05, // 0.65, 0.70, 0.75, 0.80
        improvements: [],
        unitFeedback: [],
      });
    }

    const evaluation = await oc.evaluate(auth.id);
    expect(evaluation).not.toBeNull();
    expect(evaluation!.runIds).toHaveLength(4);
    expect(evaluation!.activityResults).toHaveLength(2);

    // Token validation (established) should have expectation results
    const tokenResult = evaluation!.activityResults.find(
      (a) => a.activityId === 'token-validation',
    );
    expect(tokenResult).toBeDefined();
    expect(tokenResult!.expectationResults.length).toBeGreaterThan(0);

    // Quality expectation should be met (avg = 0.725, threshold 0.6)
    const qualityResult = tokenResult!.expectationResults.find(
      (e) => e.metric === 'averageQuality',
    );
    expect(qualityResult).toBeDefined();
    expect(qualityResult!.met).toBe(true);
    expect(qualityResult!.actualValue).toBeGreaterThan(0.6);

    // Session management (experimental) should have hypothesis results
    const sessionResult = evaluation!.activityResults.find(
      (a) => a.activityId === 'session-management',
    );
    expect(sessionResult).toBeDefined();
    expect(sessionResult!.hypothesisResults).toHaveLength(1);
    // Only 4 runs, needs 5 — should still be testing
    expect(sessionResult!.hypothesisResults[0].newStatus).toBe('testing');
  });

  it('evaluateAndLearn stores learning units', async () => {
    const { oc, auth } = await setupWithPlan();

    // Run some cycles
    for (let i = 0; i < 3; i++) {
      const output = await oc.run({
        query: `Query ${i}`,
        contextId: auth.id,
        profile: 'retrieve-and-process',
      });
      await oc.reportOutcome({
        runId: output.runId,
        reportedAt: Date.now(),
        reportedBy: 'test',
        success: true,
        quality: 0.7,
        improvements: [],
        unitFeedback: [],
      });
    }

    const result = await oc.evaluateAndLearn(auth.id);
    expect(result).not.toBeNull();
    expect(result!.learnings.length).toBeGreaterThan(0);

    // Learning units should be records (immutable)
    const learningUnits = result!.learnings.filter(
      (u) => u.metadata.contentType === 'learning',
    );
    expect(learningUnits.length).toBeGreaterThan(0);
    expect(learningUnits[0].metadata.mutability).toBe('record');
  });

  it('suggests maturity change when hypotheses get results', async () => {
    const { oc, auth } = await setupWithPlan();

    // Run enough cycles (>= 5) for the hypothesis to be evaluable
    for (let i = 0; i < 6; i++) {
      const output = await oc.run({
        query: `Session query ${i}`,
        contextId: auth.id,
        profile: 'retrieve-and-process',
      });
      await oc.reportOutcome({
        runId: output.runId,
        reportedAt: Date.now(),
        reportedBy: 'test',
        success: true,
        quality: 0.7,
        improvements: [],
        unitFeedback: [],
      });
    }

    const evaluation = await oc.evaluate(auth.id);
    const sessionResult = evaluation!.activityResults.find(
      (a) => a.activityId === 'session-management',
    );

    // Hypothesis should have enough observations
    expect(sessionResult!.hypothesisResults[0].observationCount).toBeGreaterThanOrEqual(5);
  });

  it('revises plan and supersedes the old version', async () => {
    const { oc, auth } = await setupWithPlan();

    // Revise the plan
    const revised = await oc.revisePlan(auth.id, [
      {
        type: 'change-maturity',
        activityId: 'session-management',
        description: 'Session management is now emerging',
        detail: { from: 'experimental', to: 'emerging' },
      },
    ]);

    expect(revised).not.toBeNull();
    expect(revised!.length).toBeGreaterThan(0);

    // Get the current plan — should be the revised one
    const current = await oc.getPlan(auth.id);
    expect(current).not.toBeNull();
    const sessionActivity = current!.activities.find(
      (a) => a.id === 'session-management',
    );
    expect(sessionActivity!.maturity).toBe('emerging');
    expect(current!.revision).toBe(2);
  });

  it('suggested revisions include expectation misses', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });
    await oc.acquire('Some content.', ctx.id);

    // Create plan with a high quality expectation that won't be met
    const plan: Plan = {
      contextId: ctx.id,
      name: 'High Bar Plan',
      description: 'Intentionally high expectations',
      maturity: 'established',
      activities: [
        {
          id: 'main',
          name: 'Main Activity',
          description: 'Main work',
          maturity: 'established',
          expectations: [
            {
              id: 'exp-high-quality',
              metric: 'averageQuality',
              description: 'Quality must be above 0.95',
              operator: 'gte',
              value: 0.95,
              tolerance: 0.02,
            },
          ],
          hypotheses: [],
        },
      ],
      revision: 1,
    };
    await oc.createPlan(plan);

    // Run with mediocre quality
    for (let i = 0; i < 3; i++) {
      const output = await oc.run({
        query: `Query ${i}`,
        contextId: ctx.id,
        profile: 'retrieve-and-process',
      });
      await oc.reportOutcome({
        runId: output.runId,
        reportedAt: Date.now(),
        reportedBy: 'test',
        success: true,
        quality: 0.6, // Way below 0.95
        improvements: [],
        unitFeedback: [],
      });
    }

    const evaluation = await oc.evaluate(ctx.id);
    expect(evaluation!.suggestedRevisions.length).toBeGreaterThan(0);

    const expRevision = evaluation!.suggestedRevisions.find(
      (r) => r.type === 'update-expectation',
    );
    expect(expRevision).toBeDefined();
    expect(expRevision!.description).toContain('not met');
  });
});
