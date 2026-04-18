/**
 * Orchestrated Walkthrough
 *
 * Exercises the full orchestration flow with live events and a post-run trace.
 * Uses:
 * - TransformersEmbedder (bge-small-en-v1.5) for real embeddings
 * - A scripted mock agent that produces valid meta-action outputs (so we can
 *   run without an API key and observe the infrastructure end-to-end)
 * - The SDLC seed knowledge base for realistic retrieval
 *
 * You'll see:
 * 1. Live event stream during execution
 * 2. A post-run trace showing everything that happened
 *
 * Run: npx tsx examples/walkthrough/walkthrough-orchestrated.ts
 */

import {
  OpenContext,
  Orchestrator,
  DAGEngine,
  ExecutionEventEmitter,
  createLiveEventLogger,
  formatOrchestrationTrace,
  filterEvents,
  META_ACTION_IDS,
  InMemoryFeedbackStore,
  VectorRetriever,
} from '../../src/index.js';
import { TransformersEmbedder } from '../../src/storage/transformers-embedder.js';
import { QueryConstructor } from '../../src/execution/query-constructor.js';
import type {
  Objective,
  ActionExecutor,
  ValidationResult,
  ExecutionEvent,
  PlanNode,
} from '../../src/index.js';
import { SDLC_SEED } from './seed-sdlc.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function hr(title: string) {
  console.log(`\n${'═'.repeat(74)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(74)}`);
}

// ── Scripted mock agent ─────────────────────────────────────────────────────

/**
 * An executor that produces realistic structured outputs for each meta-action.
 * Queries the knowledge base via a real retriever so we can see real retrieval
 * quality, but the "agent reasoning" is scripted to produce valid JSON outputs.
 */
function makeScriptedExecutor(
  oc: OpenContext,
  onNode?: (node: PlanNode, queryCount: number) => void,
): ActionExecutor {
  const retriever = new VectorRetriever({
    embedder: oc.embedder,
    vectorStore: oc.vectorStore,
    unitStore: oc.unitStore,
    contextStore: oc.contextStore,
    scopeResolver: oc.scopeResolver,
  });
  const qc = new QueryConstructor({ maxTotalUnits: 20 });

  return {
    async execute(node, inputs) {
      const action = node.action!;

      // Run the real query construction and retrieval so we can observe it
      let queryResult = null;
      try {
        const constructed = qc.construct(action, null, action.contextId, inputs);
        queryResult = await qc.execute(constructed, retriever);
      } catch (err) {
        // ignore query errors in the mock
      }

      onNode?.(node, queryResult?.units.length ?? 0);

      const outputs: Record<string, unknown> = {};
      const validationResults: ValidationResult[] = [];

      switch (action.id) {
        case META_ACTION_IDS.CLASSIFY: {
          const desc = String(inputs['objectiveDescription'] ?? '');
          outputs['classification'] = {
            matches: [
              { id: 'User', kind: 'resource-type', relevance: 0.82, rationale: 'Core project entity' },
              { id: 'JWTToken', kind: 'resource-type', relevance: 0.78, rationale: 'Security artifact' },
            ],
            gaps: desc.includes('refund') ? [
              { concept: 'RefundPolicy', suggestedKind: 'resource-type' as const },
            ] : [],
            overallConfidence: 0.8,
          };
          outputs['__objectiveDescription'] = desc;
          break;
        }

        case META_ACTION_IDS.CLARIFY:
          outputs['clarifiedObjective'] = {
            description: `Structured: ${String(inputs['objectiveDescription'] ?? '')}`,
            domainReferences: [
              { id: 'User', role: 'primary' },
              { id: 'JWTToken', role: 'produced' },
            ],
            acceptanceCriteria: [
              'Endpoint returns valid JWT for correct credentials',
              'Endpoint rejects invalid credentials with 401',
              'All behavior tests pass',
            ],
          };
          outputs['isFullyClarified'] = true;
          break;

        case META_ACTION_IDS.SEARCH:
          outputs['searchResult'] = {
            candidates: [
              { actionId: 'impl:login-endpoint', relevance: 0.9, rationale: 'Directly produces the needed endpoint' },
              { actionId: 'impl:jwt-issuer', relevance: 0.65, rationale: 'Could be composed with validator' },
            ],
            coverageAssessment: 'complete',
          };
          break;

        case META_ACTION_IDS.SELECT:
          outputs['selection'] = {
            decision: 'select-one',
            selectedActionIds: ['impl:login-endpoint'],
            executionMode: 'sequential',
            rationale: 'Highest-relevance candidate with direct output match',
          };
          break;

        case META_ACTION_IDS.EXECUTE:
          outputs['executionResult'] = {
            outcomes: [
              {
                actionId: 'impl:login-endpoint',
                status: 'succeeded',
                outputs: {
                  implementation: 'function loginEndpoint(req, res) { /* ... */ }',
                  tests: 'describe("login endpoint", () => { /* ... */ });',
                },
              },
            ],
          };
          break;

        case META_ACTION_IDS.INCORPORATE:
          outputs['incorporation'] = {
            updates: {
              domainChanges: [
                { kind: 'create', targetType: 'resource', description: 'Created LoginEndpoint resource' },
              ],
              planUpdates: [
                { kind: 'mark-complete', description: 'Main execution node completed' },
              ],
              learnings: [
                {
                  observation: 'Query templates for implementation actions worked well — high context quality reported',
                  category: 'process-improvement',
                  recommendation: 'Consider similar template structure for adjacent action types',
                },
              ],
            },
            objectiveStatus: 'completed',
          };
          break;

        default:
          outputs['response'] = 'generic';
      }

      return { outputs, validationResults };
    },
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  hr('OpenContext Orchestrated Walkthrough');
  console.log('\n  Uses bge-small-en-v1.5 embeddings + scripted mock agent.');
  console.log('  (First run downloads model ~130MB.)');

  // ── Setup ───────────────────────────────────────────────────────────────
  hr('SETUP');

  const embedder = new TransformersEmbedder({
    model: 'Xenova/bge-small-en-v1.5',
    dimensions: 384,
  });
  const oc = new OpenContext({ embedder });

  // Build project hierarchy
  const root = await oc.createContext({
    name: 'SaaS Todo Project',
    description: 'Full-stack SaaS Todo application',
  });

  const contextByKey = new Map<string, string>();
  contextByKey.set('root', root.id);

  for (const key of ['auth', 'api', 'frontend', 'database', 'deployment'] as const) {
    const desc = {
      auth: 'Authentication, JWT tokens, sessions',
      api: 'REST API endpoints, middleware',
      frontend: 'React frontend application',
      database: 'PostgreSQL schema and migrations',
      deployment: 'AWS CDK infrastructure',
    }[key];
    const ctx = await oc.createContext({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      description: desc,
      parentId: root.id,
    });
    contextByKey.set(key, ctx.id);
  }

  console.log(`\n  Created 6 bounded contexts`);

  // Seed system knowledge
  const systemUnits = await oc.seed(root.id);
  console.log(`  Seeded ${systemUnits.length} system knowledge units`);

  // Seed meta-actions
  const metaUnits = await oc.seedMetaActions(root.id);
  console.log(`  Seeded ${metaUnits.length} meta-action definitions`);

  // Seed SDLC knowledge
  let sdlcCount = 0;
  for (const unit of SDLC_SEED) {
    const ctxId = contextByKey.get(unit.context) ?? root.id;
    await oc.acquire(unit.content, ctxId, {
      contentType: unit.contentType,
      tags: unit.tags,
      sourceType: 'system',
    });
    sdlcCount++;
  }
  console.log(`  Seeded ${sdlcCount} SDLC knowledge units`);

  const allUnits = await oc.unitStore.getAll();
  console.log(`  Total knowledge base: ${allUnits.length} units`);

  // ── Set up observation ──────────────────────────────────────────────────
  hr('OBSERVATION SETUP');

  const emitter = new ExecutionEventEmitter();

  // Subscribe the live logger
  emitter.subscribe(createLiveEventLogger({ color: true, indentByDepth: true }));

  // Also capture all events for summary stats
  const allEvents: ExecutionEvent[] = [];
  emitter.subscribe((e) => allEvents.push(e));

  console.log(`\n  Event emitter connected. Live log will appear during execution.`);

  // ── Run orchestration ───────────────────────────────────────────────────
  hr('ORCHESTRATION');

  const objective: Objective = {
    id: 'obj:login-endpoint',
    name: 'Implement login endpoint',
    description:
      'Design and implement the POST /api/v1/auth/login endpoint. ' +
      'It should accept email and password, validate credentials against the users table, ' +
      'and return a JWT access token and refresh token on success.',
    contextId: contextByKey.get('auth')!,
    acceptanceCriteria: [
      'Endpoint returns 200 with JWT tokens for valid credentials',
      'Endpoint returns 401 for invalid credentials',
      'Rate limited to 5 attempts per minute per email',
      'All behavior tests pass',
    ],
    isLearningObjective: false,
    priority: 1,
    status: 'defined',
  };

  console.log(`\n  Objective: ${objective.name}`);
  console.log(`  Description: ${objective.description.substring(0, 120)}...`);
  console.log(`  Starting orchestration...\n`);

  const engine = new DAGEngine(emitter);
  const executor = makeScriptedExecutor(oc);
  const orchestrator = new Orchestrator(engine, executor, oc.unitStore, { emitter });

  const startTime = Date.now();
  const result = await orchestrator.orchestrate(objective);
  const elapsedMs = Date.now() - startTime;

  console.log(`\n  Orchestration finished in ${elapsedMs}ms`);

  // ── Event summary ───────────────────────────────────────────────────────
  hr('EVENT SUMMARY');

  const eventTypes = new Map<string, number>();
  for (const e of allEvents) {
    eventTypes.set(e.type, (eventTypes.get(e.type) ?? 0) + 1);
  }

  console.log(`\n  Total events: ${allEvents.length}`);
  console.log(`  By type:`);
  for (const [type, count] of [...eventTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }

  // ── Post-run trace ──────────────────────────────────────────────────────
  hr('POST-RUN TRACE');

  const trace = formatOrchestrationTrace(result, {
    color: true,
    maxOutputLength: 180,
    includeQueryDetails: true,
    includeValidations: true,
  });
  console.log(trace);

  // ── Analysis ────────────────────────────────────────────────────────────
  hr('ANALYSIS');

  console.log(`\n  Final status: ${result.status}`);
  console.log(`  Total nodes executed: ${result.totalNodesExecuted}`);
  console.log(`  Sub-objectives spawned: ${result.subObjectives.length}`);

  // Look at retrieval quality across all meta-action nodes
  console.log(`\n  Retrieval quality per meta-action:`);
  for (const node of result.metaPlan.nodes.values()) {
    const attempt = node.attempts[node.attempts.length - 1];
    if (!attempt?.executionMeta) continue;
    const queryResult = attempt.executionMeta['queryResult'] as any;
    if (!queryResult) continue;
    console.log(`    ${node.action!.name}: ${queryResult.totalUnitsRetrieved} units`);
    for (const r of queryResult.retrievals ?? []) {
      console.log(`      - ${r.purpose}: ${r.unitsReturned} units`);
    }
  }

  hr('WALKTHROUGH COMPLETE');
}

main().catch((err) => {
  console.error('\nWalkthrough failed:', err);
  process.exit(1);
});
