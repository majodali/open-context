import { describe, it, expect } from 'vitest';
import {
  OpenContext,
  DeterministicEmbedder,
  OPENCONTEXT_SEED,
} from '../src/index.js';

describe('Self-hosting: seed content', () => {
  it('seeds the root context with system knowledge', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });

    const root = await oc.createContext({
      name: 'Root',
      description: 'Project root',
    });

    const seeded = await oc.seed(root.id);
    expect(seeded.length).toBeGreaterThan(0);
    // Each seed unit becomes one or more semantic units
    expect(seeded.length).toBeGreaterThanOrEqual(OPENCONTEXT_SEED.length);

    // Should be able to retrieve system knowledge
    const result = await oc.retrieve('How do bounded contexts work?', root.id);
    expect(result.units.length).toBeGreaterThan(0);
  });

  it('seed content is tagged and typed correctly', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    const seeded = await oc.seed(root.id);

    // All should have 'seed' tag
    for (const unit of seeded) {
      expect(unit.metadata.tags).toContain('seed');
    }

    // Should include various content types
    const types = new Set(seeded.map((u) => u.metadata.contentType));
    expect(types.has('fact')).toBe(true);
    expect(types.has('instruction')).toBe(true);
    expect(types.has('rule')).toBe(true);
  });
});

describe('Self-hosting: configuration as knowledge', () => {
  it('stores and retrieves configuration', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const root = await oc.createContext({ name: 'Root', description: 'Root' });

    await oc.setConfig(root.id, 'maxRetrievalResults', 30, 'root-agent');

    const value = await oc.getConfig(root.id, 'maxRetrievalResults');
    expect(value).toBe(30);
  });

  it('config resolves hierarchically (child overrides parent)', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });

    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    const child = await oc.createContext({
      name: 'Child', description: 'Child', parentId: root.id,
    });

    // Set at root level
    await oc.setConfig(root.id, 'chunkSize', 500);
    // Override at child level
    await oc.setConfig(child.id, 'chunkSize', 200);

    // Child should see its own override
    const childValue = await oc.getConfig(child.id, 'chunkSize');
    expect(childValue).toBe(200);

    // Root should see its own value
    const rootValue = await oc.getConfig(root.id, 'chunkSize');
    expect(rootValue).toBe(500);
  });

  it('config without child override inherits from parent', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });

    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    const child = await oc.createContext({
      name: 'Child', description: 'Child', parentId: root.id,
    });

    await oc.setConfig(root.id, 'globalSetting', 'inherited-value');

    const value = await oc.getConfig(child.id, 'globalSetting');
    expect(value).toBe('inherited-value');
  });
});

describe('Self-hosting: insights', () => {
  it('generates insight units from metrics analysis', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });

    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });
    await oc.acquire('Some knowledge to retrieve.', ctx.id);

    // Run some pipeline cycles to generate metrics
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
        quality: 0.7,
        improvements: [],
        unitFeedback: [],
      });
    }

    // Generate insights
    const { report, insights } = await oc.generateInsights(ctx.id);

    expect(report.runCount).toBe(3);
    expect(insights.length).toBeGreaterThan(0);

    // Insights should be stored as semantic units
    for (const insight of insights) {
      expect(insight.metadata.contentType).toBe('insight');
      expect(insight.metadata.mutability).toBe('record');
    }
  });
});

describe('Self-hosting: role definitions', () => {
  it('stores role definitions as knowledge', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });

    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    // Root agent creates auth context — initially unrestricted so it can set it up
    const auth = await oc.createContext({
      name: 'Auth',
      description: 'Authentication module',
      parentId: root.id,
      writeRules: { writers: ['root-agent', 'auth-agent'] },
    });

    // Root agent defines the role for the auth context
    await oc.acquire(
      'Role: auth-agent. Model: claude-sonnet. ' +
      'Responsibilities: implement and maintain authentication logic, ' +
      'validate tokens, manage sessions. ' +
      'Write access: auth context only.',
      auth.id,
      {
        contentType: 'role-definition',
        tags: ['role:auth-agent'],
        createdBy: 'root-agent',
      },
    );

    // Should be retrievable
    const result = await oc.retrieve('What is the auth agent responsible for?', auth.id);
    expect(result.units.length).toBeGreaterThan(0);
    const roleUnit = result.units.find(
      (su) => su.unit.metadata.contentType === 'role-definition',
    );
    expect(roleUnit).toBeDefined();
  });
});
