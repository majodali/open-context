/**
 * Run a single cycle of a walkthrough sequence, with pause-for-review.
 *
 * Reads the Anthropic API key from `.anthropic.key` (gitignored) at the
 * project root. Falls back to ANTHROPIC_API_KEY env var if the file is absent.
 *
 * Usage:
 *   # Start a new sequence (runs cycle 0):
 *   npx tsx examples/walkthrough/run-cycle.ts spice-rack
 *
 *   # Continue the same sequence (runs next cycle, loads saved state):
 *   npx tsx examples/walkthrough/run-cycle.ts spice-rack --continue
 *
 * Outputs (written to examples/walkthrough/runs/<sequenceId>/):
 *   - cycle-N-report.md          Review-ready markdown
 *   - cycle-N-result.json        Full archive of the run
 *   - state-after-cycle-N.json   Saved OpenContext state
 *   - sequence-state.json        Sequence metadata
 *
 * The workflow:
 *   1. Run this script → cycle N completes → artifacts saved
 *   2. Review the markdown report
 *   3. (Optional) edit corpus, retrain, adjust scenario
 *   4. Run again with --continue → cycle N+1 runs against saved state
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SequenceRunner, type SequenceState } from '../../src/walkthrough/sequence.js';
import { TransformersEmbedder } from '../../src/storage/transformers-embedder.js';
import {
  formatWalkthroughSummary,
  formatWalkthroughMarkdown,
  walkthroughToJson,
} from '../../src/walkthrough/report.js';
import { SPICE_RACK_SEQUENCE } from './scenarios/spice-rack.js';
import type { WalkthroughSequence, CycleSpec } from '../../src/walkthrough/sequence.js';
import { loadAnthropicKey } from './load-api-key.js';

// ---------------------------------------------------------------------------
// Known sequences (extend as you add more)
// ---------------------------------------------------------------------------

const SEQUENCES: Record<string, WalkthroughSequence> = {
  'spice-rack': SPICE_RACK_SEQUENCE,
};

/**
 * Inject an API key into any cycle that uses the Anthropic agent.
 * Scenarios leave apiKey unset so we can plug it in here without the key
 * ever appearing in committed scenario files.
 */
function injectAnthropicKey(
  sequence: WalkthroughSequence,
  apiKey: string,
): WalkthroughSequence {
  const withKey: CycleSpec[] = sequence.cycles.map((c) => {
    if (c.execution.agent.type !== 'anthropic') return c;
    return {
      ...c,
      execution: {
        ...c.execution,
        agent: { ...c.execution.agent, apiKey },
      },
    };
  });
  return { ...sequence, cycles: withKey };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const sequenceId = args[0];
  const isContinue = args.includes('--continue');

  if (!sequenceId || !SEQUENCES[sequenceId]) {
    console.error(`Usage: run-cycle <sequence-id> [--continue]`);
    console.error(`Available sequences: ${Object.keys(SEQUENCES).join(', ')}`);
    process.exit(1);
  }

  // Load API key once and inject into the sequence's agent configs.
  // (Throws with a clear message if .anthropic.key / ANTHROPIC_API_KEY are absent.)
  const apiKey = loadAnthropicKey();
  const sequence = injectAnthropicKey(SEQUENCES[sequenceId], apiKey);

  const runDir = join(
    process.cwd(),
    'examples/walkthrough/runs',
    sequence.id,
  );
  await mkdir(runDir, { recursive: true });

  const statePath = join(runDir, 'sequence-state.json');
  const savePath = (cycleIndex: number) =>
    join(runDir, `state-after-cycle-${cycleIndex}.json`);

  console.log(`\nSequence: ${sequence.name}`);
  console.log(`Cycles defined: ${sequence.cycles.length}`);
  console.log(`Corpus: ${sequence.corpus.name} (${sequence.corpus.units.length} units)`);
  console.log(`Run dir: ${runDir}\n`);

  // Prepare the runner
  const embedder = new TransformersEmbedder({
    model: 'Xenova/bge-small-en-v1.5',
    dimensions: 384,
  });
  const runner = new SequenceRunner({ embedder });

  // Start or resume
  if (isContinue && existsSync(statePath)) {
    console.log('Resuming from saved state...');
    const stateJson = await readFile(statePath, 'utf-8');
    const state: SequenceState = JSON.parse(stateJson);
    // Find the latest saved OpenContext state file
    const lastCycle = state.cyclesCompleted - 1;
    const lastSavePath = savePath(lastCycle);
    if (!existsSync(lastSavePath)) {
      console.error(`Cannot find saved state at ${lastSavePath}. Aborting.`);
      process.exit(1);
    }
    await runner.resumeFromSave(lastSavePath, state);
    console.log(`Resumed. Cycles completed so far: ${state.cyclesCompleted}`);
  } else {
    if (isContinue) {
      console.log('--continue was specified but no saved state found. Starting fresh.');
    }
    console.log('Starting new sequence (seeding corpus + meta-actions)...');
    await runner.startSequence(sequence);
    console.log('Sequence started.');
  }

  // Run the next cycle
  console.log('\nRunning next cycle...\n');
  const cycleIndex = runner.getState()!.cyclesCompleted;
  const maybeResult = await runner.runNextCycle(sequence);
  if (!maybeResult) {
    console.log('Sequence is already complete — all cycles have been run.');
    return;
  }
  const { result, state } = maybeResult;

  console.log('\n' + formatWalkthroughSummary(result));

  // Persist artifacts
  const markdownPath = join(runDir, `cycle-${cycleIndex}-report.md`);
  const jsonPath = join(runDir, `cycle-${cycleIndex}-result.json`);
  await writeFile(markdownPath, formatWalkthroughMarkdown(result));
  await writeFile(jsonPath, walkthroughToJson(result));

  // Save OpenContext state + sequence state for next cycle
  await runner.saveState(savePath(cycleIndex));
  await writeFile(statePath, JSON.stringify(state, null, 2));

  console.log(`\nArtifacts written:`);
  console.log(`  ${markdownPath}`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${savePath(cycleIndex)}`);
  console.log(`  ${statePath}`);

  // Surface review notes if present
  const cycleSpec = sequence.cycles[cycleIndex];
  if (cycleSpec?.reviewNote) {
    console.log('\n── Review note ─────────────────────────────────────────────');
    console.log(cycleSpec.reviewNote);
    console.log('──────────────────────────────────────────────────────────────');
  }

  // Next steps
  if (state.cyclesCompleted < sequence.cycles.length) {
    console.log(
      `\nCycle ${cycleIndex} complete. ${sequence.cycles.length - state.cyclesCompleted} ` +
      `cycle(s) remaining. Review the report, then run:`,
    );
    console.log(`  npx tsx examples/walkthrough/run-cycle.ts ${sequenceId} --continue`);
  } else {
    console.log(`\nSequence complete — all ${sequence.cycles.length} cycle(s) done.`);
  }
}

main().catch((err) => {
  console.error('Walkthrough failed:', err);
  process.exit(1);
});
