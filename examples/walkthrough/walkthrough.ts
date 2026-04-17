/**
 * OpenContext Walkthrough
 *
 * Steps through each phase of the knowledge lifecycle with an example project.
 * Uses the DeterministicEmbedder by default so no API keys are needed to verify
 * the flow. Replace with TransformersEmbedder or OpenAIEmbedder for real use.
 *
 * Run: npx tsx examples/walkthrough/walkthrough.ts
 */

import {
  OpenContext,
  DeterministicEmbedder,
  OPENCONTEXT_SEED,
} from '../../src/index.js';
import type { ScoredUnit, RunOutcome } from '../../src/index.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function hr(title: string) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(70)}\n`);
}

function printUnits(label: string, units: { unit?: any; content?: string; metadata?: any; id?: string }[]) {
  console.log(`  ${label} (${units.length} units):`);
  for (const item of units.slice(0, 5)) {
    const u = item.unit ?? item;
    console.log(`    [${u.metadata.contentType}] ${u.content.substring(0, 80)}...`);
    console.log(`      id=${u.id.substring(0, 8)} ctx=${u.contextId?.substring(0, 8)} tags=${u.metadata.tags.join(',')}`);
  }
  if (units.length > 5) console.log(`    ... and ${units.length - 5} more`);
}

function printScored(label: string, scored: ScoredUnit[]) {
  console.log(`  ${label} (${scored.length} results):`);
  for (const su of scored.slice(0, 5)) {
    console.log(`    score=${su.score.toFixed(3)} (vec=${su.vectorSimilarity.toFixed(3)} × scope=${su.scopeWeight.toFixed(2)})`);
    console.log(`      [${su.unit.metadata.contentType}] ${su.unit.content.substring(0, 70)}...`);
    console.log(`      ctx=${su.unit.contextId.substring(0, 8)} tags=${su.unit.metadata.tags.join(',')}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Using DeterministicEmbedder for walkthrough — swap for real embeddings later
  const oc = new OpenContext({
    embedder: new DeterministicEmbedder(128),
  });

  // ────────────────────────────────────────────────────────────────────────
  hr('PHASE 1: Create project hierarchy');
  // ────────────────────────────────────────────────────────────────────────

  const root = await oc.createContext({
    name: 'Todo App Project',
    description: 'A full-stack todo application with auth, API, and frontend',
  });
  console.log(`  Root context: ${root.id} "${root.name}"`);
  console.log(`  Scope rules: self=${root.scopeRules.selfWeight} parent=${root.scopeRules.parentWeight} sibling=${root.scopeRules.siblingWeight} child=${root.scopeRules.childWeight}`);
  console.log(`  Write rules: writers=[${root.writeRules.writers.join(',')}] (unrestricted)`);

  const auth = await oc.createContext({
    name: 'Authentication',
    description: 'User authentication and authorization',
    parentId: root.id,
  });

  const api = await oc.createContext({
    name: 'API',
    description: 'REST API endpoints',
    parentId: root.id,
  });

  const frontend = await oc.createContext({
    name: 'Frontend',
    description: 'React frontend application',
    parentId: root.id,
  });

  console.log(`\n  Hierarchy:`);
  console.log(`  ${root.name} (${root.id.substring(0, 8)})`);
  console.log(`  ├── ${auth.name} (${auth.id.substring(0, 8)})`);
  console.log(`  ├── ${api.name} (${api.id.substring(0, 8)})`);
  console.log(`  └── ${frontend.name} (${frontend.id.substring(0, 8)})`);

  // ────────────────────────────────────────────────────────────────────────
  hr('PHASE 2: Seed system knowledge');
  // ────────────────────────────────────────────────────────────────────────

  const seedUnits = await oc.seed(root.id);
  console.log(`  Seeded ${seedUnits.length} units into root context`);
  const seedTypes = new Map<string, number>();
  for (const u of seedUnits) {
    seedTypes.set(u.metadata.contentType, (seedTypes.get(u.metadata.contentType) ?? 0) + 1);
  }
  console.log(`  By type: ${[...seedTypes.entries()].map(([t, c]) => `${t}=${c}`).join(', ')}`);

  // ────────────────────────────────────────────────────────────────────────
  hr('PHASE 3: Acquire project knowledge');
  // ────────────────────────────────────────────────────────────────────────

  // Root-level project knowledge
  const rootKnowledge = await oc.acquire(
    'The project uses TypeScript and Node.js. ' +
    'Deploy to AWS using CDK. ' +
    'Use PostgreSQL for the database. ' +
    'All API responses must follow the JSON:API specification.',
    root.id,
    { sourceType: 'user', tags: ['architecture'] },
  );
  console.log(`  Root knowledge acquired:`);
  printUnits('Root', rootKnowledge);

  // Auth-specific knowledge
  const authKnowledge = await oc.acquire(
    'Use JWT tokens for authentication with RS256 signing. ' +
    'Tokens expire after 1 hour. ' +
    'Refresh tokens expire after 30 days. ' +
    'Always validate the token signature before processing any request. ' +
    'Store password hashes using bcrypt with cost factor 12.',
    auth.id,
    { sourceType: 'user', tags: ['security'] },
  );
  console.log(`\n  Auth knowledge acquired:`);
  printUnits('Auth', authKnowledge);

  // API-specific knowledge
  const apiKnowledge = await oc.acquire(
    'REST endpoints follow /api/v1/{resource} pattern. ' +
    'Use Express.js for the API server. ' +
    'All endpoints require authentication except /api/v1/auth/login and /api/v1/auth/register. ' +
    'Rate limit to 100 requests per minute per user. ' +
    'Return 429 status code when rate limit is exceeded.',
    api.id,
    { sourceType: 'user', tags: ['api-design'] },
  );
  console.log(`\n  API knowledge acquired:`);
  printUnits('API', apiKnowledge);

  // Frontend knowledge
  const feKnowledge = await oc.acquire(
    'Use React 18 with TypeScript. ' +
    'Use TanStack Query for data fetching. ' +
    'Use Tailwind CSS for styling. ' +
    'Store auth tokens in httpOnly cookies, never in localStorage.',
    frontend.id,
    { sourceType: 'user', tags: ['frontend'] },
  );
  console.log(`\n  Frontend knowledge acquired:`);
  printUnits('Frontend', feKnowledge);

  // ────────────────────────────────────────────────────────────────────────
  hr('PHASE 4: Scoped retrieval');
  // ────────────────────────────────────────────────────────────────────────

  // Query from the Auth context — should find auth-specific content with highest scores,
  // but also surface relevant info from root (parent) and siblings
  console.log('  Query: "How should I validate user authentication?" (from Auth context)\n');
  const authResult = await oc.retrieve('How should I validate user authentication?', auth.id, {
    maxResults: 8,
  });

  printScored('Auth-scoped retrieval', authResult.units);
  console.log(`\n  Scopes searched: ${authResult.scopesSearched.length}`);
  for (const scope of authResult.scopesSearched) {
    console.log(`    ${scope.relationship}: ${scope.contextId.substring(0, 8)} weight=${scope.weight.toFixed(2)} depth=${scope.depth}`);
  }

  // Query from the API context — should find API-specific content plus relevant auth/root content
  console.log('\n  Query: "How should I secure the API endpoints?" (from API context)\n');
  const apiResult = await oc.retrieve('How should I secure the API endpoints?', api.id, {
    maxResults: 8,
  });
  printScored('API-scoped retrieval', apiResult.units);

  // ────────────────────────────────────────────────────────────────────────
  hr('PHASE 5: Pipeline run (retrieve-and-process)');
  // ────────────────────────────────────────────────────────────────────────

  const output = await oc.run({
    query: 'Implement the login endpoint for the API',
    contextId: api.id,
    profile: 'retrieve-and-process',
  });

  console.log(`  Run ID: ${output.runId}`);
  console.log(`  Units retrieved: ${output.retrievedUnits.length}`);
  console.log(`  Agent output preview: ${output.agentOutput?.response.substring(0, 200)}...`);

  // Check the run record
  const runRecord = await oc.metricsStore.getRun(output.runId);
  console.log(`\n  Run record captured:`);
  console.log(`    Duration: ${runRecord?.totalDurationMs}ms`);
  console.log(`    Steps: ${runRecord?.steps.map(s => `${s.stepId}(${s.durationMs}ms)`).join(' → ')}`);

  // ────────────────────────────────────────────────────────────────────────
  hr('PHASE 6: Report outcome');
  // ────────────────────────────────────────────────────────────────────────

  const outcome: RunOutcome = {
    runId: output.runId,
    reportedAt: Date.now(),
    reportedBy: 'walkthrough-user',
    success: true,
    quality: 0.7,
    improvements: [
      {
        rank: 1,
        category: 'retrieval',
        description: 'Auth-specific security rules should score higher when building auth-related endpoints',
      },
      {
        rank: 2,
        category: 'missing-knowledge',
        description: 'No knowledge about Express.js middleware patterns for auth',
      },
    ],
    unitFeedback: output.retrievedUnits.length > 0
      ? [{ unitId: output.retrievedUnits[0].unit.id, signal: 'helpful' }]
      : [],
  };

  await oc.reportOutcome(outcome);
  console.log(`  Outcome reported: quality=${outcome.quality}, improvements=${outcome.improvements.length}`);
  for (const imp of outcome.improvements) {
    console.log(`    #${imp.rank} [${imp.category}] ${imp.description}`);
  }

  // ────────────────────────────────────────────────────────────────────────
  hr('PHASE 7: Configuration as knowledge');
  // ────────────────────────────────────────────────────────────────────────

  await oc.setConfig(root.id, 'maxRetrievalResults', 20);
  await oc.setConfig(auth.id, 'maxRetrievalResults', 30); // Override for auth

  const rootConfig = await oc.getConfig(root.id, 'maxRetrievalResults');
  const authConfig = await oc.getConfig(auth.id, 'maxRetrievalResults');
  const apiConfig = await oc.getConfig(api.id, 'maxRetrievalResults'); // Inherits from root

  console.log(`  Config 'maxRetrievalResults':`);
  console.log(`    Root: ${rootConfig}`);
  console.log(`    Auth: ${authConfig} (overridden)`);
  console.log(`    API:  ${apiConfig} (inherited from root)`);

  // ────────────────────────────────────────────────────────────────────────
  hr('PHASE 8: Proposals');
  // ────────────────────────────────────────────────────────────────────────

  // Frontend agent proposes that the API team add CORS configuration
  const proposals = await oc.createProposal(
    frontend.id,
    api.id,
    'Proposed: API should return CORS headers allowing the frontend origin. ' +
    'Currently the frontend cannot make cross-origin requests to the API.',
    'frontend-agent',
  );
  console.log(`  Proposal created: "${proposals[0].content.substring(0, 60)}..."`);
  console.log(`    Written to: ${frontend.name} (${proposals[0].contextId.substring(0, 8)})`);
  console.log(`    Targets: ${api.name}`);

  const pending = await oc.getPendingProposals(api.id);
  console.log(`  Pending proposals for API context: ${pending.length}`);

  await oc.resolveProposal(proposals[0].id, 'approved');
  console.log(`  Proposal approved.`);

  // ────────────────────────────────────────────────────────────────────────
  hr('PHASE 9: Metrics analysis');
  // ────────────────────────────────────────────────────────────────────────

  // Run a few more cycles to generate data
  for (let i = 0; i < 3; i++) {
    const r = await oc.run({
      query: `Query ${i}: What patterns should I follow?`,
      contextId: [root.id, auth.id, api.id][i % 3],
      profile: 'retrieve-and-process',
    });
    await oc.reportOutcome({
      runId: r.runId,
      reportedAt: Date.now(),
      reportedBy: 'walkthrough',
      success: true,
      quality: 0.6 + i * 0.1,
      improvements: i === 0
        ? [{ rank: 1, category: 'retrieval' as const, description: 'Improve cross-context discovery' }]
        : [],
      unitFeedback: [],
    });
  }

  const report = await oc.analyzeMetrics();
  console.log(`  Analysis report:`);
  console.log(`    Runs analyzed: ${report.runCount}`);
  console.log(`    Success rate: ${(report.overallSuccessRate * 100).toFixed(0)}%`);
  console.log(`    Avg quality: ${(report.averageQuality * 100).toFixed(0)}%`);
  console.log(`    Contexts analyzed: ${report.contextAnalyses.length}`);
  for (const ctx of report.contextAnalyses) {
    console.log(`      ${ctx.contextName}: ${ctx.runCount} runs, quality=${(ctx.averageQuality * 100).toFixed(0)}%`);
  }
  console.log(`    Top suggestions: ${report.topSuggestions.length}`);
  for (const s of report.topSuggestions) {
    console.log(`      [${s.category}] ${s.description} (freq=${s.frequency}, rank=${s.averageRank.toFixed(1)})`);
  }

  // Generate insights
  const { insights } = await oc.generateInsights(root.id);
  console.log(`\n  Insights generated: ${insights.length} units`);
  for (const insight of insights.slice(0, 3)) {
    console.log(`    ${insight.content.substring(0, 80)}...`);
  }

  // ────────────────────────────────────────────────────────────────────────
  hr('PHASE 10: Persistence');
  // ────────────────────────────────────────────────────────────────────────

  const savePath = './examples/walkthrough/walkthrough-state.json';
  await oc.save(savePath);
  console.log(`  State saved to ${savePath}`);

  // Quick stats
  const allUnits = await oc.unitStore.getAll();
  const allContexts = await oc.contextStore.getAll();
  const allRuns = await oc.metricsStore.getAllRuns();
  console.log(`\n  Final state:`);
  console.log(`    Contexts: ${allContexts.length}`);
  console.log(`    Semantic units: ${allUnits.length}`);
  console.log(`    Pipeline runs: ${allRuns.length}`);
  console.log(`    Units by type:`);
  const byType = new Map<string, number>();
  for (const u of allUnits) {
    byType.set(u.metadata.contentType, (byType.get(u.metadata.contentType) ?? 0) + 1);
  }
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${type}: ${count}`);
  }

  hr('WALKTHROUGH COMPLETE');
}

main().catch(console.error);
