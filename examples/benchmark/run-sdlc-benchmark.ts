/**
 * SDLC Benchmark Runner
 *
 * Runs the hand-crafted SDLC evaluation suite against three retrieval strategies:
 * - flat-vector (baseline)
 * - hierarchical (current default)
 * - tag-aware (boost factor 1.0)
 *
 * Uses bge-small-en-v1.5 for real embeddings.
 *
 * Run: npx tsx examples/benchmark/run-sdlc-benchmark.ts
 */

import {
  BenchmarkRunner,
  formatBenchmarkComparison,
  FLAT_VECTOR_STRATEGY,
  HIERARCHICAL_STRATEGY,
  tagAwareStrategy,
  SDLC_EVALUATION_SUITE,
} from '../../src/index.js';
import { TransformersEmbedder } from '../../src/storage/transformers-embedder.js';

function hr(title: string) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(80)}`);
}

async function main() {
  hr('OpenContext SDLC Retrieval Benchmark');
  console.log('\n  Strategies: flat-vector vs hierarchical vs tag-aware');
  console.log('  Embedder: bge-small-en-v1.5 (local)');
  console.log('  Suite: SDLC SaaS Todo project\n');

  const suite = SDLC_EVALUATION_SUITE;
  console.log(`  Corpus: ${suite.corpus.units.length} units, ${suite.corpus.contexts.length} contexts`);
  console.log(`  Queries: ${suite.queries.length}`);

  const queriesByCategory = new Map<string, number>();
  for (const q of suite.queries) {
    queriesByCategory.set(q.category, (queriesByCategory.get(q.category) ?? 0) + 1);
  }
  console.log(`  By category: ${[...queriesByCategory.entries()].map(([c, n]) => `${c}=${n}`).join(', ')}`);

  hr('Loading suite');

  const embedder = new TransformersEmbedder({
    model: 'Xenova/bge-small-en-v1.5',
    dimensions: 384,
  });
  const runner = new BenchmarkRunner({ kValues: [1, 3, 5, 10], maxResults: 20 });

  const loadStart = Date.now();
  await runner.loadSuite(suite, embedder);
  console.log(`  Loaded in ${Date.now() - loadStart}ms`);

  hr('Running strategies');

  const strategies = [
    FLAT_VECTOR_STRATEGY,
    HIERARCHICAL_STRATEGY,
    tagAwareStrategy(0.5),
    tagAwareStrategy(1.0),
    tagAwareStrategy(2.0),
  ];

  console.log(`  Running ${strategies.length} strategies × ${suite.queries.length} queries...\n`);

  const results = await runner.runStrategies(strategies);
  for (const r of results) {
    console.log(`  ${r.strategyName}: ${r.totalDurationMs}ms`);
  }

  hr('RESULTS');

  const comparison = runner.compare(results, 'flat-vector');
  console.log('\n' + formatBenchmarkComparison(comparison));

  hr('Per-query nDCG@10 deltas (vs flat-vector)');

  // Show per-query breakdown for cross-context and methodological queries
  // (where hierarchical/tag-aware should help most)
  const baseline = results.find((r) => r.strategyName === 'flat-vector')!;
  const baselineByQuery = new Map(baseline.queryResults.map((q) => [q.queryId, q]));

  for (const r of results) {
    if (r.strategyName === 'flat-vector') continue;
    console.log(`\n  ${r.strategyName} vs flat-vector:`);
    const interesting = r.queryResults.filter(
      (q) => q.category === 'cross-context' || q.category === 'methodological',
    );
    for (const q of interesting) {
      const base = baselineByQuery.get(q.queryId);
      if (!base) continue;
      const cn = q.metrics.ndcg[10] ?? 0;
      const bn = base.metrics.ndcg[10] ?? 0;
      const delta = cn - bn;
      const sign = delta > 0 ? '+' : '';
      const arrow = delta > 0.05 ? '▲' : delta < -0.05 ? '▼' : '·';
      const queryDef = suite.queries.find((qd) => qd.id === q.queryId)!;
      console.log(
        `    ${arrow} [${q.category}] nDCG: ${bn.toFixed(2)} → ${cn.toFixed(2)} ` +
        `(${sign}${delta.toFixed(2)}) "${queryDef.text.substring(0, 60)}..."`,
      );
    }
  }

  hr('BENCHMARK COMPLETE');
}

main().catch((err) => {
  console.error('\nBenchmark failed:', err);
  process.exit(1);
});
