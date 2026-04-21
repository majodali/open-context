/**
 * Spice Rack Parametric Design — Walkthrough Sequence
 *
 * A realistic project to exercise OpenContext across multiple cycles:
 * - Cycle 1: initial objective from workspace root ("I want to build X, where do I start?")
 * - Later cycles: dive into specific sub-objectives as the project takes shape
 *
 * Chosen because:
 * - Cross-domain (CAD, manufacturing, methodology, math for parametrics)
 * - Not a canonical training-data example, so correct answers depend on corpus
 * - Small enough to produce visible progress in a few cycles
 * - Physical constraints are real and have right/wrong answers we can check
 *
 * Each cycle is a CycleSpec — the sequence provides the shared corpus.
 */

import type { WalkthroughSequence, CycleSpec } from '../../../src/walkthrough/sequence.js';
import { EXPANDED_WORKSPACE_CORPUS } from '../../../src/corpora/expanded-workspace.js';
import type { Objective } from '../../../src/index.js';

// ---------------------------------------------------------------------------
// Cycle 1: inception — help me get started
// ---------------------------------------------------------------------------

const cycle1_inception: CycleSpec = {
  id: 'spice-rack-cycle-1-inception',
  name: 'Cycle 1: Inception — help me start',
  description:
    'Open-ended objective from workspace root. The agent should help structure ' +
    'the problem, surface methodology, identify unknowns, and propose a ' +
    'decomposition into sub-objectives. It should NOT leap into detailed design.',
  reviewNote:
    'Before approving cycle 2: inspect the response for (a) use of methodology ' +
    'units (V-model, consider alternatives, risk-first), (b) proposed sub-objectives ' +
    'with real structure, (c) honest identification of missing info (jar dimensions, ' +
    'cabinet details, material preferences).',
  objectives: [
    {
      id: 'obj-spice-rack-inception',
      name: 'Design a parametric 3D-printed spice rack',
      description:
        'I want to design a parametric 3D-printed spice rack that mounts under a ' +
        'kitchen cabinet. It should hold my spice jars and be adjustable for ' +
        'different cabinet depths and jar counts. I will print it on an FDM ' +
        'printer. Where do I start?',
      contextId: 'workspace', // Start from the top — cross-domain retrieval in play
      acceptanceCriteria: [
        'Problem is decomposed into reasonable sub-objectives',
        'Relevant methodology surfaces (V-model, DFM, alternatives)',
        'Unknown / missing information is identified clearly',
        'No assumption-based detailed design before scope is clear',
      ],
      isLearningObjective: false,
      priority: 1,
      status: 'defined',
    } satisfies Objective,
  ],
  execution: {
    agent: {
      type: 'anthropic',
      model: 'claude-haiku-4-5', // cheaper + realistic-capability stress test
      maxTokens: 4096,
      temperature: 0.5,
    },
    maxContextTokens: 10_000,
    maxToolCallRounds: 5,
    useStandardTools: true,
    recordTrainingData: true,
    systemPrompt:
      'You are an agent operating inside OpenContext, a knowledge-management system. ' +
      'Your responses must follow the structured output schema for the action you are ' +
      'performing. When the provided knowledge is insufficient, say so clearly in the ' +
      '`missingInformation` field rather than making up details. Prefer decomposition ' +
      'and planning over speculative implementation details on open-ended requests.',
  },
  expectations: {
    expectOutput: true,
    expectBasicValidation: true,
    minSelfReportedSufficiency: 'mostly-sufficient',
  },
};

// ---------------------------------------------------------------------------
// Cycle 2 (placeholder — populated after reviewing cycle 1)
// ---------------------------------------------------------------------------

// Cycle 2 would typically dive into a specific sub-objective that cycle 1
// surfaced — e.g., "measure my jar inventory and decide on parametric
// dimensions" or "choose the mounting approach for my cabinet type".
//
// Deliberately left out for the first run: we want to see what cycle 1 proposes
// before committing to what cycle 2 tests.

// ---------------------------------------------------------------------------
// Sequence export
// ---------------------------------------------------------------------------

export const SPICE_RACK_SEQUENCE: WalkthroughSequence = {
  id: 'spice-rack-parametric',
  name: 'Parametric spice rack — project from inception',
  description:
    'Follow a real small physical design project through initial planning and ' +
    'design decisions. Tests cross-domain retrieval (methodology + physical ' +
    'engineering + CAD) and the accumulation story: does cycle 2 benefit from ' +
    'what was learned in cycle 1?',
  domains: ['physical-engineering', 'cad', 'manufacturing', 'methodology'],
  familiarity: 'moderate', // 3D-printed brackets are general; THIS specific design is not canonical
  corpus: EXPANDED_WORKSPACE_CORPUS,
  cycles: [
    cycle1_inception,
    // cycle2 added after cycle 1 review
  ],
};
