import { describe, it, expect } from 'vitest';
import {
  EXPANDED_WORKSPACE_CORPUS,
  getExpandedWorkspaceCounts,
  WalkthroughRunner,
  DeterministicEmbedder,
  BenchmarkRunner,
  FLAT_VECTOR_STRATEGY,
  tagAwareStrategy,
  featureBasedStrategy,
  DEFAULT_WEIGHTS,
} from '../src/index.js';
import type {
  WalkthroughScenario,
  AgentAdapter,
  AgentOutput,
  AssembledInput,
  BenchmarkQuery,
  EvaluationSuite,
} from '../src/index.js';

// ── Structural tests ──────────────────────────────────────────────────────

describe('Expanded workspace corpus', () => {
  const corpus = EXPANDED_WORKSPACE_CORPUS;

  it('has non-trivial size across all target domains', () => {
    const counts = getExpandedWorkspaceCounts();
    expect(counts.totalUnits).toBeGreaterThanOrEqual(100);
    expect(counts.totalUnits).toBeLessThanOrEqual(200); // not bloated
    expect(counts.totalContexts).toBeGreaterThanOrEqual(10);
  });

  it('has all expected domains', () => {
    const contextIds = new Set(corpus.contexts.map((c) => c.id));
    expect(contextIds.has('workspace')).toBe(true);
    expect(contextIds.has('methodology')).toBe(true);
    expect(contextIds.has('sdlc')).toBe(true);
    expect(contextIds.has('pm')).toBe(true);
    expect(contextIds.has('process')).toBe(true);
    expect(contextIds.has('pe')).toBe(true);
    expect(contextIds.has('math')).toBe(true);
  });

  it('every unit references a valid context', () => {
    const contextIds = new Set(corpus.contexts.map((c) => c.id));
    for (const u of corpus.units) {
      expect(contextIds.has(u.contextId)).toBe(true);
    }
  });

  it('every parent context exists', () => {
    const contextIds = new Set(corpus.contexts.map((c) => c.id));
    for (const c of corpus.contexts) {
      if (c.parentId) {
        expect(contextIds.has(c.parentId)).toBe(true);
      }
    }
  });

  it('hierarchy has no cycles (topologically sortable)', () => {
    // Ensure we can topo-sort without detecting a cycle
    const placed = new Set<string>();
    const remaining = [...corpus.contexts];
    let lastPlaced = -1;
    while (remaining.length > 0 && placed.size !== lastPlaced) {
      lastPlaced = placed.size;
      for (let i = remaining.length - 1; i >= 0; i--) {
        const c = remaining[i];
        if (!c.parentId || placed.has(c.parentId)) {
          placed.add(c.id);
          remaining.splice(i, 1);
        }
      }
    }
    expect(remaining).toHaveLength(0);
  });

  it('all corpus IDs are unique', () => {
    const ids = corpus.units.map((u) => u.corpusId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all context IDs are unique', () => {
    const ids = corpus.contexts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has meaningful coverage per domain', () => {
    const counts = getExpandedWorkspaceCounts();
    const byCtx = counts.unitsByContext;

    // Methodology and SDLC are expected to be denser
    expect(byCtx['methodology']).toBeGreaterThanOrEqual(8);

    // All other domain roots should have at least some content (including sub-contexts)
    const domainRoots = ['pm', 'process', 'math'];
    for (const root of domainRoots) {
      expect(byCtx[root] ?? 0).toBeGreaterThanOrEqual(5);
    }

    // SDLC has sub-contexts — total across sdlc-* should be substantial
    const sdlcTotal = Object.entries(byCtx)
      .filter(([id]) => id === 'sdlc' || id.startsWith('sdlc-'))
      .reduce((sum, [, n]) => sum + n, 0);
    expect(sdlcTotal).toBeGreaterThanOrEqual(20);

    // PE has sub-contexts too
    const peTotal = Object.entries(byCtx)
      .filter(([id]) => id === 'pe' || id.startsWith('pe-'))
      .reduce((sum, [, n]) => sum + n, 0);
    expect(peTotal).toBeGreaterThanOrEqual(10);
  });

  it('methodology units are tagged as applicable across domains', () => {
    const methodUnits = corpus.units.filter((u) => u.contextId === 'methodology');
    expect(methodUnits.length).toBeGreaterThan(0);
    // Check some have explicit cross-domain applicability
    const crossDomain = methodUnits.filter((u) =>
      u.tags.some((t) => t.startsWith('methodology:'))
      || u.tags.some((t) => t.startsWith('applies-to:')),
    );
    expect(crossDomain.length).toBeGreaterThan(0);
  });
});

// ── Walkthrough loads the corpus cleanly ──────────────────────────────────

class MinimalScriptedAgent implements AgentAdapter {
  async process(_input: AssembledInput): Promise<AgentOutput> {
    // Return quickly — the test just verifies the corpus loads.
    // Use a minimal valid meta-action output that covers any step.
    return {
      response: '```json\n' + JSON.stringify({
        matches: [],
        gaps: [],
        overallConfidence: 0.5,
        structuredObjective: {
          description: 'test',
          domainReferences: [],
          acceptanceCriteria: ['ok'],
        },
        isFullyClarified: true,
        candidates: [],
        coverageAssessment: 'none',
        decision: 'create-exploratory',
        rationale: 'mock',
        outcomes: [],
        updates: { domainChanges: [], planUpdates: [], learnings: [] },
        objectiveStatus: 'completed',
      }) + '\n```',
    };
  }
}

describe('Expanded workspace: end-to-end walkthrough load', () => {
  it('WalkthroughRunner loads the entire corpus without error', async () => {
    const scenario: WalkthroughScenario = {
      id: 'load-test',
      name: 'Load test',
      description: 'Verify the expanded corpus loads cleanly',
      corpus: EXPANDED_WORKSPACE_CORPUS,
      objectives: [
        {
          id: 'obj',
          name: 'Test objective',
          description: 'Any objective to trigger orchestration',
          contextId: 'sdlc',
          acceptanceCriteria: ['Orchestration attempts to run'],
          isLearningObjective: false,
          priority: 1,
          status: 'defined',
        },
      ],
      execution: {
        agent: { type: 'custom', adapter: new MinimalScriptedAgent() },
        useStandardTools: false,
        recordTrainingData: false,
      },
    };

    const runner = new WalkthroughRunner({
      embedder: new DeterministicEmbedder(64),
    });

    const result = await runner.run(scenario);

    // All corpus units should have been seeded
    expect(result.stats.unitsInCorpus).toBe(EXPANDED_WORKSPACE_CORPUS.units.length);
    expect(result.stats.contextsInCorpus).toBe(EXPANDED_WORKSPACE_CORPUS.contexts.length);
    // Orchestration should have produced at least some output
    expect(result.tiers.producedOutput).toBe(true);
  });
});

// ── Cross-domain retrieval sanity check ──────────────────────────────────

describe('Expanded workspace: cross-domain retrieval sanity', () => {
  /**
   * Build an ad-hoc BenchmarkQuery set aimed at cross-domain retrieval.
   * We are not running rigorous benchmark metrics here — just sanity-checking
   * that queries from one domain can surface content from another via tags.
   */
  const crossDomainQueries: BenchmarkQuery[] = [
    {
      id: 'cd-vmodel-engineering',
      text: 'How should I apply V-model decomposition to a mechanical design project?',
      fromContextId: 'pe',
      queryTags: ['methodology:v-model', 'domain:physical-engineering'],
      category: 'cross-context',
      judgments: [
        { corpusId: 'method-vmodel', relevance: 'essential' },
        { corpusId: 'method-tests-as-spec', relevance: 'helpful' },
      ],
    },
    {
      id: 'cd-stats-for-ab',
      text: 'I need to run an A/B test on a new frontend change. What statistics do I need?',
      fromContextId: 'sdlc-frontend',
      queryTags: ['math', 'statistics', 'applies-to:software'],
      category: 'cross-context',
      judgments: [
        { corpusId: 'math-ab-testing', relevance: 'essential' },
        { corpusId: 'math-hypothesis-test', relevance: 'essential' },
        { corpusId: 'math-std-dev', relevance: 'helpful' },
      ],
    },
    {
      id: 'cd-retrospective-sdlc',
      text: 'The auth module is done. Run a retrospective.',
      fromContextId: 'sdlc-auth',
      queryTags: ['pm', 'agile'],
      category: 'cross-context',
      judgments: [
        { corpusId: 'pm-retrospective', relevance: 'essential' },
        { corpusId: 'pm-lessons-learned', relevance: 'helpful' },
      ],
    },
  ];

  const adHocSuite: EvaluationSuite = {
    name: 'expanded-cross-domain-adhoc',
    description: 'Ad-hoc cross-domain queries on the expanded corpus',
    corpus: EXPANDED_WORKSPACE_CORPUS,
    queries: crossDomainQueries,
  };

  it('feature-based retrieval surfaces relevant cross-domain content', async () => {
    const runner = new BenchmarkRunner({ kValues: [3, 5, 10], maxResults: 10 });
    await runner.loadSuite(adHocSuite, new DeterministicEmbedder(64));

    const results = await runner.runStrategies([
      FLAT_VECTOR_STRATEGY,
      tagAwareStrategy(1.0),
      featureBasedStrategy({ name: 'feature-default', weights: DEFAULT_WEIGHTS }),
    ]);

    // DeterministicEmbedder is not semantic, so we can't assert high quality — but
    // we can verify the harness runs and all strategies return SOME results.
    for (const r of results) {
      expect(r.queryResults).toHaveLength(crossDomainQueries.length);
      // Each query result should have retrieved at least one unit
      for (const qr of r.queryResults) {
        expect(qr.retrieved.length).toBeGreaterThan(0);
      }
    }
  });
});
