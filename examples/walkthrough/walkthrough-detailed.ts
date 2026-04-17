/**
 * Detailed OpenContext Walkthrough
 *
 * Exercises the full stack with real embeddings (bge-small-en-v1.5):
 * 1. Create project hierarchy
 * 2. Seed system knowledge + SDLC practices + project knowledge
 * 3. Test retrieval quality with targeted queries
 * 4. Test query construction from action definitions
 * 5. Test scoped retrieval across hierarchy
 * 6. Execute a DAG with the agent executor
 * 7. Analyze feedback and metrics
 *
 * Run: npx tsx examples/walkthrough/walkthrough-detailed.ts
 */

import {
  OpenContext,
  OPENCONTEXT_SEED,
  VectorRetriever,
  QueryConstructor,
  InMemoryFeedbackStore,
  AgentActionExecutor,
  DAGEngine,
  NoopAgentAdapter,
} from '../../src/index.js';
import { TransformersEmbedder } from '../../src/storage/transformers-embedder.js';
import type {
  ScoredUnit,
  BoundedContext,
  ActionDefinition,
  PlanDAG,
  PlanNode,
  PlanEdge,
  Objective,
} from '../../src/index.js';
import { SDLC_SEED, SEED_CONTEXTS } from './seed-sdlc.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function hr(title: string) {
  console.log(`\n${'═'.repeat(74)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(74)}\n`);
}

function printScored(label: string, scored: ScoredUnit[], max = 5) {
  console.log(`  ${label} (${scored.length} results):`);
  for (const su of scored.slice(0, max)) {
    const ctx = su.unit.contextId.substring(0, 8);
    const type = su.unit.metadata.contentType.padEnd(14);
    const tags = su.unit.metadata.tags.slice(0, 3).join(',');
    const content = su.unit.content.substring(0, 75).replace(/\n/g, ' ');
    console.log(`    ${su.score.toFixed(3)} [${type}] ctx:${ctx} (${tags})`);
    console.log(`         ${content}...`);
  }
  if (scored.length > max) console.log(`    ... and ${scored.length - max} more`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Initializing with bge-small-en-v1.5 embeddings...');
  console.log('(First run downloads model ~130MB)\n');

  const embedder = new TransformersEmbedder({
    model: 'Xenova/bge-small-en-v1.5',
    dimensions: 384,
  });

  const oc = new OpenContext({ embedder });

  // ──────────────────────────────────────────────────────────────────────
  hr('PHASE 1: Create project hierarchy');
  // ──────────────────────────────────────────────────────────────────────

  const contexts = new Map<string, BoundedContext>();

  const root = await oc.createContext({
    name: 'SaaS Todo Project',
    description: 'Full-stack SaaS Todo application with auth, API, frontend, and deployment',
  });
  contexts.set('root', root);

  const contextDefs: { name: string; key: string; desc: string }[] = [
    { key: 'auth', name: 'Authentication', desc: 'User authentication, JWT tokens, session management' },
    { key: 'api', name: 'API', desc: 'REST API endpoints, middleware, request handling' },
    { key: 'frontend', name: 'Frontend', desc: 'React frontend application, UI components, routing' },
    { key: 'database', name: 'Database', desc: 'PostgreSQL schema, migrations, queries' },
    { key: 'deployment', name: 'Deployment', desc: 'AWS CDK infrastructure, CI/CD, environments' },
  ];

  for (const def of contextDefs) {
    const ctx = await oc.createContext({
      name: def.name,
      description: def.desc,
      parentId: root.id,
    });
    contexts.set(def.key, ctx);
  }

  console.log('  Hierarchy:');
  console.log(`  ${root.name} (${root.id.substring(0, 8)})`);
  for (const def of contextDefs) {
    const ctx = contexts.get(def.key)!;
    const last = def === contextDefs[contextDefs.length - 1];
    console.log(`  ${last ? '└' : '├'}── ${ctx.name} (${ctx.id.substring(0, 8)})`);
  }

  // ──────────────────────────────────────────────────────────────────────
  hr('PHASE 2: Seed knowledge base');
  // ──────────────────────────────────────────────────────────────────────

  // System knowledge
  console.log('  Seeding OpenContext system knowledge...');
  const systemUnits = await oc.seed(root.id);
  console.log(`    ${systemUnits.length} system units`);

  // SDLC knowledge
  console.log('  Seeding SDLC practices and project knowledge...');
  let sdlcCount = 0;
  for (const unit of SDLC_SEED) {
    const ctxId = contexts.get(unit.context)?.id ?? root.id;
    await oc.acquire(unit.content, ctxId, {
      contentType: unit.contentType,
      tags: unit.tags,
      sourceType: 'system',
    });
    sdlcCount++;
  }
  console.log(`    ${sdlcCount} SDLC units`);

  // Summary
  const allUnits = await oc.unitStore.getAll();
  const byType = new Map<string, number>();
  const byContext = new Map<string, number>();
  for (const u of allUnits) {
    byType.set(u.metadata.contentType, (byType.get(u.metadata.contentType) ?? 0) + 1);
    byContext.set(u.contextId, (byContext.get(u.contextId) ?? 0) + 1);
  }

  console.log(`\n  Total: ${allUnits.length} semantic units`);
  console.log('  By type:', [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}(${c})`).join(', '));
  console.log('  By context:');
  for (const [key, ctx] of contexts) {
    const count = byContext.get(ctx.id) ?? 0;
    if (count > 0) console.log(`    ${ctx.name}: ${count} units`);
  }

  // ──────────────────────────────────────────────────────────────────────
  hr('PHASE 3: Retrieval quality — targeted queries');
  // ──────────────────────────────────────────────────────────────────────

  const queries = [
    {
      query: 'How should I validate JWT tokens in the API middleware?',
      context: 'api',
      expectTags: ['auth', 'jwt', 'middleware'],
      description: 'Cross-context query: API context asking about auth',
    },
    {
      query: 'What testing approach should I use for the login endpoint?',
      context: 'auth',
      expectTags: ['testing', 'bdd', 'v-model'],
      description: 'Retrieval should surface both auth details and testing practices',
    },
    {
      query: 'How should I handle errors in API responses?',
      context: 'api',
      expectTags: ['api', 'errors', 'error-handling'],
      description: 'Should find both API error conventions and general error handling rules',
    },
    {
      query: 'What database tables do I need for user authentication?',
      context: 'database',
      expectTags: ['database', 'schema', 'auth'],
      description: 'Cross-context: DB context pulling auth-related schema',
    },
    {
      query: 'Before implementing the todo list component, what alternatives should I consider?',
      context: 'frontend',
      expectTags: ['epistemic', 'frontend'],
      description: 'Should surface epistemic discipline rules about considering alternatives',
    },
  ];

  for (const q of queries) {
    console.log(`  Query: "${q.query}"`);
    console.log(`  Context: ${q.context} | ${q.description}`);

    const ctxId = contexts.get(q.context)!.id;
    const result = await oc.retrieve(q.query, ctxId, { maxResults: 8 });

    printScored('Results', result.units);

    // Check if expected tags appear in results
    const resultTags = new Set(result.units.flatMap((su) => su.unit.metadata.tags));
    const found = q.expectTags.filter((t) => resultTags.has(t));
    const missed = q.expectTags.filter((t) => !resultTags.has(t));
    console.log(`  Expected tags found: ${found.join(', ') || 'none'}`);
    if (missed.length > 0) console.log(`  Expected tags missed: ${missed.join(', ')}`);

    // Show scope distribution
    const scopeDist = new Map<string, number>();
    for (const su of result.units) {
      const ctxName = [...contexts.entries()].find(([, c]) => c.id === su.unit.contextId)?.[0] ?? 'unknown';
      scopeDist.set(ctxName, (scopeDist.get(ctxName) ?? 0) + 1);
    }
    console.log(`  Scope distribution: ${[...scopeDist.entries()].map(([k, v]) => `${k}(${v})`).join(', ')}`);
    console.log();
  }

  // ──────────────────────────────────────────────────────────────────────
  hr('PHASE 4: Query construction from action definition');
  // ──────────────────────────────────────────────────────────────────────

  const implementLoginAction: ActionDefinition = {
    id: 'implement-login',
    name: 'Implement Login Endpoint',
    description: 'Implement the POST /api/v1/auth/login endpoint that validates credentials and returns JWT tokens',
    contextId: contexts.get('auth')!.id,
    inputs: [
      { name: 'auth-spec', description: 'Authentication specification and requirements', required: true, resourceTypeId: 'AuthSpec' },
      { name: 'db-schema', description: 'Database schema for users and tokens tables', required: true, resourceTypeId: 'DatabaseSchema' },
    ],
    outputs: [
      { name: 'implementation', description: 'The login endpoint implementation code', required: true },
      { name: 'tests', description: 'Behavior tests for the login endpoint', required: true },
    ],
    performer: { type: 'agent', agentConfig: { model: 'claude-sonnet-4-20250514' } },
    instructions: 'Implement the login endpoint following the authentication specification. Write behavior tests first (Given-When-Then), then implement to pass them. Use bcrypt for password verification and generate JWT tokens with RS256.',
    parameters: [],
    validations: [
      { id: 'v-tests', description: 'All behavior tests pass', method: 'test', blocking: true },
      { id: 'v-review', description: 'Code follows project conventions', method: 'agent-review', blocking: false },
    ],
    riskIndicators: [
      { id: 'ri-attempts', description: 'Too many attempts', type: 'attempt-count', threshold: 3, response: 'interrupt' },
    ],
    maxAttempts: 3,
    tags: ['auth', 'implementation', 'login'],
  };

  const qc = new QueryConstructor({ maxTotalUnits: 30 });
  const constructed = qc.construct(
    implementLoginAction,
    null,
    contexts.get('auth')!.id,
  );

  console.log(`  Action: ${implementLoginAction.name}`);
  console.log(`  Constructed ${constructed.retrievals.length} retrievals:`);
  for (const r of constructed.retrievals) {
    console.log(`    [priority ${r.priority}] ${r.purpose}: "${r.query.substring(0, 60)}..."`);
  }

  const retriever = new VectorRetriever({
    embedder: oc.embedder,
    vectorStore: oc.vectorStore,
    unitStore: oc.unitStore,
    contextStore: oc.contextStore,
    scopeResolver: oc.scopeResolver,
  });

  const queryResult = await qc.execute(constructed, retriever);

  console.log(`\n  Query result: ${queryResult.units.length} units (budget: ${constructed.maxTotalUnits})`);
  for (const rr of queryResult.retrievalResults) {
    console.log(`    ${rr.purpose}: ${rr.unitsReturned} units from "${rr.query.substring(0, 50)}..."`);
  }

  console.log('\n  Top 10 units for agent context:');
  printScored('Assembled context', queryResult.units, 10);

  // Check content coverage
  const hasAuth = queryResult.units.some((u) => u.unit.metadata.tags.includes('auth'));
  const hasJwt = queryResult.units.some((u) => u.unit.metadata.tags.includes('jwt'));
  const hasTesting = queryResult.units.some((u) => u.unit.metadata.tags.includes('testing') || u.unit.metadata.tags.includes('bdd'));
  const hasDb = queryResult.units.some((u) => u.unit.metadata.tags.includes('database') || u.unit.metadata.tags.includes('schema'));
  const hasEpistemic = queryResult.units.some((u) => u.unit.metadata.tags.includes('epistemic'));

  console.log('\n  Content coverage check:');
  console.log(`    Auth knowledge: ${hasAuth ? '✓' : '✗'}`);
  console.log(`    JWT specifics: ${hasJwt ? '✓' : '✗'}`);
  console.log(`    Testing practices: ${hasTesting ? '✓' : '✗'}`);
  console.log(`    Database schema: ${hasDb ? '✓' : '✗'}`);
  console.log(`    Epistemic discipline: ${hasEpistemic ? '✓' : '✗'}`);

  // ──────────────────────────────────────────────────────────────────────
  hr('PHASE 5: DAG execution with agent executor');
  // ──────────────────────────────────────────────────────────────────────

  // Build a simple 2-node DAG: design → implement
  const designAction: ActionDefinition = {
    id: 'design-login',
    name: 'Design Login Endpoint',
    description: 'Design the login endpoint: define behavior specifications, API contract, and error cases',
    contextId: contexts.get('auth')!.id,
    inputs: [],
    outputs: [
      { name: 'design', description: 'Login endpoint design document with behavior specs', required: true },
    ],
    performer: { type: 'agent' },
    instructions: 'Design the login endpoint. Define Given-When-Then behavior specifications for all cases: successful login, wrong password, nonexistent user, rate limiting. Define the API contract.',
    parameters: [],
    validations: [],
    riskIndicators: [],
    maxAttempts: 2,
    tags: ['auth', 'design'],
  };

  const implAction: ActionDefinition = {
    ...implementLoginAction,
    inputs: [
      { name: 'design', description: 'Login endpoint design from previous step', required: true },
    ],
  };

  const designNode: PlanNode = {
    id: 'design-node',
    actionId: 'design-login',
    action: designAction,
    status: 'pending',
    attemptCount: 0,
    attempts: [],
    risk: 0.3,
    value: 5,
    expanded: false,
  };

  const implNode: PlanNode = {
    id: 'impl-node',
    actionId: 'implement-login',
    action: implAction,
    status: 'pending',
    attemptCount: 0,
    attempts: [],
    risk: 0.6,
    value: 8,
    expanded: false,
  };

  const objective: Objective = {
    id: 'obj-login',
    name: 'Implement Login',
    description: 'Design and implement the login endpoint with tests',
    contextId: contexts.get('auth')!.id,
    acceptanceCriteria: ['Login endpoint returns JWT tokens', 'All behavior tests pass', 'Rate limiting enforced'],
    isLearningObjective: false,
    priority: 1,
    status: 'executing',
  };

  const dag: PlanDAG = {
    id: 'dag-login',
    objectiveId: objective.id,
    contextId: contexts.get('auth')!.id,
    nodes: new Map([
      ['design-node', designNode],
      ['impl-node', implNode],
    ]),
    edges: [{
      id: 'edge-1',
      sourceNodeId: 'design-node',
      sourceOutput: 'design',
      targetNodeId: 'impl-node',
      targetInput: 'design',
    }],
    externalInputs: [],
    assumptions: [
      { id: 'a1', description: 'bcrypt and JWT libraries are available', confidence: 0.95 },
    ],
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'draft',
  };

  const engine = new DAGEngine();
  const errors = engine.validateAndSeal(dag);
  console.log(`  DAG validation: ${errors.length === 0 ? 'VALID' : `${errors.length} errors`}`);

  // Execute with a NoopAgentAdapter (captures what the agent would receive)
  const feedbackStore = new InMemoryFeedbackStore();
  const executor = new AgentActionExecutor(
    retriever,
    new NoopAgentAdapter(),
    feedbackStore,
    { requestFeedback: false, maxContextTokens: 12000 },
  );

  console.log('  Executing DAG...\n');
  await engine.executePlan(dag, executor);

  console.log(`  DAG status: ${dag.status}`);
  for (const [id, node] of dag.nodes) {
    console.log(`  Node '${id}': ${node.status} (${node.attempts.length} attempts)`);
    if (node.attempts.length > 0) {
      const last = node.attempts[node.attempts.length - 1];
      const meta = last.executionMeta as any;
      if (meta?.queryResult) {
        console.log(`    Retrieved ${meta.queryResult.totalUnitsRetrieved} knowledge units`);
        for (const r of meta.queryResult.retrievals) {
          console.log(`      ${r.purpose}: ${r.unitsReturned} units`);
        }
      }
      if (last.outputs['response']) {
        const resp = String(last.outputs['response']);
        console.log(`    Response preview: ${resp.substring(0, 120).replace(/\n/g, ' ')}...`);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  hr('PHASE 6: Summary and statistics');
  // ──────────────────────────────────────────────────────────────────────

  const finalUnits = await oc.unitStore.getAll();
  const finalContexts = await oc.contextStore.getAll();

  console.log(`  Contexts: ${finalContexts.length}`);
  console.log(`  Semantic units: ${finalUnits.length}`);

  const finalByType = new Map<string, number>();
  for (const u of finalUnits) {
    finalByType.set(u.metadata.contentType, (finalByType.get(u.metadata.contentType) ?? 0) + 1);
  }
  console.log('  Units by type:');
  for (const [type, count] of [...finalByType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }

  // Save state
  const savePath = './examples/walkthrough/walkthrough-detailed-state.json';
  await oc.save(savePath);
  console.log(`\n  State saved to ${savePath}`);

  hr('WALKTHROUGH COMPLETE');
}

main().catch(console.error);
