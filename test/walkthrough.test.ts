import { describe, it, expect } from 'vitest';
import {
  WalkthroughRunner,
  formatWalkthroughSummary,
  formatWalkthroughMarkdown,
  walkthroughToJson,
  DeterministicEmbedder,
} from '../src/index.js';
import type {
  WalkthroughScenario,
  BenchmarkCorpus,
  Objective,
  AgentAdapter,
  AgentOutput,
  AssembledInput,
} from '../src/index.js';
import { META_ACTION_IDS } from '../src/index.js';

// ── Mock agent producing scripted meta-action outputs ──────────────────────

/**
 * A scripted agent that produces valid meta-action outputs so the
 * orchestrator can complete. Used for walkthrough infrastructure tests
 * without hitting a live API.
 */
class ScriptedMetaAgent implements AgentAdapter {
  async process(input: AssembledInput): Promise<AgentOutput> {
    const text = input.sections.map((s) => s.content).join('\n');

    // Figure out which meta-action is being executed by matching instructions
    let responsePayload: string;
    if (text.includes('Classify Objective') || text.includes(META_ACTION_IDS.CLASSIFY)) {
      responsePayload = JSON.stringify({
        matches: [],
        gaps: [],
        overallConfidence: 0.5,
      });
    } else if (text.includes('Clarify Objective') || text.includes(META_ACTION_IDS.CLARIFY)) {
      responsePayload = JSON.stringify({
        structuredObjective: {
          description: 'Test objective (clarified)',
          domainReferences: [],
          acceptanceCriteria: ['Produces output'],
        },
        isFullyClarified: true,
      });
    } else if (text.includes('Search Actions') || text.includes(META_ACTION_IDS.SEARCH)) {
      responsePayload = JSON.stringify({
        candidates: [],
        coverageAssessment: 'none',
      });
    } else if (text.includes('Select Actions') || text.includes(META_ACTION_IDS.SELECT)) {
      responsePayload = JSON.stringify({
        decision: 'create-exploratory',
        rationale: 'No direct match, use exploratory approach',
      });
    } else if (text.includes('Execute Actions') || text.includes(META_ACTION_IDS.EXECUTE)) {
      responsePayload = JSON.stringify({
        outcomes: [],
      });
    } else if (text.includes('Incorporate Results') || text.includes(META_ACTION_IDS.INCORPORATE)) {
      responsePayload = JSON.stringify({
        updates: {
          domainChanges: [],
          planUpdates: [],
          learnings: [],
        },
        objectiveStatus: 'completed',
      });
    } else {
      responsePayload = JSON.stringify({ response: 'generic mock output' });
    }

    return {
      response: '```json\n' + responsePayload + '\n```\n\n---FEEDBACK---\n' +
        JSON.stringify({
          contextQuality: 'sufficient',
          usedUnits: [],
          unusedUnits: [],
          missingInformation: [],
          subsequentQueries: [],
          foundViaFollowUp: [],
          failureToFind: [],
        }),
      metadata: {
        model: 'scripted-meta-agent',
        inputTokens: 100,
        outputTokens: 50,
      },
    };
  }
}

// ── Tiny test corpus ───────────────────────────────────────────────────────

const tinyCorpus: BenchmarkCorpus = {
  name: 'tiny-walkthrough-corpus',
  description: 'Tiny test corpus',
  contexts: [
    { id: 'root', name: 'Root', description: 'Root context' },
    { id: 'sub', name: 'Sub', description: 'Sub', parentId: 'root' },
  ],
  units: [
    {
      corpusId: 'u1',
      contextId: 'root',
      contentType: 'fact',
      tags: ['general'],
      content: 'A root-level fact',
    },
    {
      corpusId: 'u2',
      contextId: 'sub',
      contentType: 'rule',
      tags: ['domain:test'],
      content: 'A rule in the sub context',
    },
  ],
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('WalkthroughRunner', () => {
  it('runs a scenario end-to-end with scripted agent', async () => {
    const scenario: WalkthroughScenario = {
      id: 'test-walkthrough-1',
      name: 'Simple walkthrough',
      description: 'Validates walkthrough infrastructure with a scripted agent',
      corpus: tinyCorpus,
      objectives: [
        {
          id: 'obj-1',
          name: 'Test objective',
          description: 'Exercise the meta-plan',
          contextId: 'root',
          acceptanceCriteria: ['Orchestration completes'],
          isLearningObjective: false,
          priority: 1,
          status: 'defined',
        },
      ],
      execution: {
        agent: { type: 'custom', adapter: new ScriptedMetaAgent() },
        useStandardTools: false, // skip tools for simplicity
        recordTrainingData: true,
      },
    };

    const runner = new WalkthroughRunner({
      embedder: new DeterministicEmbedder(64),
    });

    const result = await runner.run(scenario);

    // Structure checks
    expect(result.scenario.id).toBe('test-walkthrough-1');
    expect(result.orchestrations).toHaveLength(1);
    expect(result.events.length).toBeGreaterThan(0);

    // Tier results
    expect(result.tiers.producedOutput).toBe(true);
    expect(result.tiers.selfReportedSufficiency).toBe('sufficient');

    // Stats
    expect(result.stats.totalObjectives).toBe(1);
    expect(result.stats.totalActions).toBeGreaterThan(0);
    expect(result.stats.unitsInCorpus).toBe(2);
    expect(result.stats.contextsInCorpus).toBe(2);

    // Feedback recorded
    expect(result.feedbackRecords.length).toBeGreaterThan(0);
  });

  it('respects expectations for pass/fail evaluation', async () => {
    const scenario: WalkthroughScenario = {
      id: 'test-expectations',
      name: 'Expectations test',
      description: 'Verifies expectation-based tier evaluation',
      corpus: tinyCorpus,
      objectives: [
        {
          id: 'o',
          name: 'o',
          description: 'd',
          contextId: 'root',
          acceptanceCriteria: [],
          isLearningObjective: false,
          priority: 1,
          status: 'defined',
        },
      ],
      execution: {
        agent: { type: 'custom', adapter: new ScriptedMetaAgent() },
        useStandardTools: false,
      },
      expectations: {
        expectOutput: true,
        minSelfReportedSufficiency: 'sufficient',
      },
    };

    const runner = new WalkthroughRunner({
      embedder: new DeterministicEmbedder(64),
    });
    const result = await runner.run(scenario);

    // Scripted agent always reports 'sufficient', so expectations pass
    expect(result.tiers.passedExpectations).toBe(true);
  });

  it('supports additional contexts and units beyond the corpus', async () => {
    const scenario: WalkthroughScenario = {
      id: 'test-additional',
      name: 'Additional content',
      description: '',
      corpus: tinyCorpus,
      additionalContexts: [
        { id: 'extra', name: 'Extra', description: 'Extra scoped context', parentId: 'root' },
      ],
      additionalUnits: [
        {
          contextId: 'extra',
          contentType: 'fact',
          tags: ['extra'],
          content: 'Additional content for this scenario',
        },
      ],
      objectives: [
        {
          id: 'o',
          name: 'o',
          description: 'd',
          contextId: 'extra',
          acceptanceCriteria: [],
          isLearningObjective: false,
          priority: 1,
          status: 'defined',
        },
      ],
      execution: {
        agent: { type: 'custom', adapter: new ScriptedMetaAgent() },
        useStandardTools: false,
      },
    };

    const runner = new WalkthroughRunner({
      embedder: new DeterministicEmbedder(64),
    });
    const result = await runner.run(scenario);

    expect(result.stats.contextsInCorpus).toBe(3); // 2 from corpus + 1 additional
    expect(result.stats.unitsInCorpus).toBe(3); // 2 + 1 additional
    expect(result.orchestrations[0].status).toBe('completed');
  });

  it('can skip meta-action seeding when disabled', async () => {
    // If meta-actions aren't seeded, orchestration should fail gracefully
    const scenario: WalkthroughScenario = {
      id: 'no-seed',
      name: 'No seed',
      description: '',
      corpus: tinyCorpus,
      seedMetaActions: false, // <-- disabled
      objectives: [
        {
          id: 'o',
          name: 'o',
          description: 'd',
          contextId: 'root',
          acceptanceCriteria: [],
          isLearningObjective: false,
          priority: 1,
          status: 'defined',
        },
      ],
      execution: {
        agent: { type: 'custom', adapter: new ScriptedMetaAgent() },
        useStandardTools: false,
      },
    };

    const runner = new WalkthroughRunner({
      embedder: new DeterministicEmbedder(64),
    });
    const result = await runner.run(scenario);

    expect(result.orchestrations[0].status).toBe('failed');
    expect(result.tiers.producedOutput).toBe(false);
  });
});

// ── Report formatters ──────────────────────────────────────────────────────

describe('Walkthrough report formatters', () => {
  async function runSimpleScenario() {
    const scenario: WalkthroughScenario = {
      id: 'report-test',
      name: 'Report test',
      description: 'Scenario for exercising report formatters',
      corpus: tinyCorpus,
      objectives: [
        {
          id: 'o',
          name: 'Test',
          description: 'Test description',
          contextId: 'root',
          acceptanceCriteria: ['Works'],
          isLearningObjective: false,
          priority: 1,
          status: 'defined',
        },
      ],
      execution: {
        agent: { type: 'custom', adapter: new ScriptedMetaAgent() },
        useStandardTools: false,
      },
    };
    const runner = new WalkthroughRunner({
      embedder: new DeterministicEmbedder(64),
    });
    return runner.run(scenario);
  }

  it('formatWalkthroughSummary produces concise text', async () => {
    const result = await runSimpleScenario();
    const summary = formatWalkthroughSummary(result);
    expect(summary).toContain('Walkthrough: Report test');
    expect(summary).toContain('Tier Results:');
    expect(summary).toContain('Stats:');
    expect(summary).toContain('Orchestrations:');
  });

  it('formatWalkthroughMarkdown produces a review-ready document', async () => {
    const result = await runSimpleScenario();
    const md = formatWalkthroughMarkdown(result);
    expect(md).toContain('# Walkthrough: Report test');
    expect(md).toContain('## Tier Results');
    expect(md).toContain('## Stats');
    expect(md).toContain('## Orchestrations');
    expect(md).toContain('## External Review');
    expect(md).toContain('_Not yet reviewed._'); // pending review placeholder
  });

  it('walkthroughToJson handles Maps in orchestration results', async () => {
    const result = await runSimpleScenario();
    const json = walkthroughToJson(result);

    // Should parse without error
    const parsed = JSON.parse(json);
    expect(parsed.scenario.id).toBe('report-test');
    expect(Array.isArray(parsed.orchestrations)).toBe(true);
    // Map should be converted to a plain object
    expect(typeof parsed.orchestrations[0].metaPlan.nodes).toBe('object');
    expect(Array.isArray(parsed.orchestrations[0].metaPlan.nodes)).toBe(false);
  });

  it('markdown report includes external review section even when pending', async () => {
    const result = await runSimpleScenario();
    const md = formatWalkthroughMarkdown(result);
    expect(md).toMatch(/Fill in this section with:/);
    expect(md).toContain('Overall quality assessment');
    expect(md).toContain('Retrieval quality review');
  });
});
