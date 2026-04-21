/**
 * Dry-run the spice-rack sequence with the Noop adapter.
 * Verifies the sequencer machinery works end-to-end without spending API tokens.
 * Does not use TransformersEmbedder (which downloads a model) — uses
 * DeterministicEmbedder for speed.
 */

import { SequenceRunner } from '../../src/walkthrough/sequence.js';
import { DeterministicEmbedder } from '../../src/index.js';
import { SPICE_RACK_SEQUENCE } from './scenarios/spice-rack.js';
import type { WalkthroughSequence } from '../../src/walkthrough/sequence.js';
import { formatWalkthroughSummary } from '../../src/walkthrough/report.js';

async function main() {
  // Override the agent to Noop for the dry run
  const drySequence: WalkthroughSequence = {
    ...SPICE_RACK_SEQUENCE,
    cycles: SPICE_RACK_SEQUENCE.cycles.map((c) => ({
      ...c,
      execution: {
        ...c.execution,
        agent: { type: 'noop' },
      },
    })),
  };

  const runner = new SequenceRunner({
    embedder: new DeterministicEmbedder(64),
  });

  console.log(`Dry-run: ${drySequence.name}\n`);
  console.log('Seeding shared state...');
  await runner.startSequence(drySequence);
  console.log('Seeded.\n');

  console.log('Running cycle 0...');
  const output = await runner.runNextCycle(drySequence);
  if (!output) {
    console.log('No cycles to run.');
    return;
  }

  console.log(formatWalkthroughSummary(output.result));
  console.log(`\nCycles completed: ${output.state.cyclesCompleted}`);
  console.log(`Cycle summaries:`, output.state.cycleSummaries);
}

main().catch((err) => {
  console.error('Dry run failed:', err);
  process.exit(1);
});
