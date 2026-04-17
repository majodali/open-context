import { describe, it, expect } from 'vitest';
import { OpenContext, DeterministicEmbedder } from '../src/index.js';

describe('OpenContext integration', () => {
  it('full cycle: create hierarchy, acquire, retrieve, assemble', async () => {
    const oc = new OpenContext({
      embedder: new DeterministicEmbedder(64),
    });

    // Create hierarchy
    const root = await oc.createContext({
      name: 'Project Alpha',
      description: 'Main project context',
    });

    const auth = await oc.createContext({
      name: 'Authentication',
      description: 'Auth module',
      parentId: root.id,
    });

    const payments = await oc.createContext({
      name: 'Payments',
      description: 'Payment processing',
      parentId: root.id,
    });

    // Acquire knowledge into different contexts
    await oc.acquire(
      'Always validate JWT tokens before processing requests. Use RS256 algorithm for token signing.',
      auth.id,
      { sourceType: 'user', tags: ['security'] },
    );

    await oc.acquire(
      'Payment processing uses Stripe API. Always verify webhook signatures.',
      payments.id,
      { sourceType: 'user', tags: ['payments'] },
    );

    await oc.acquire(
      'The project uses TypeScript and Node.js. Deploy to AWS.',
      root.id,
      { sourceType: 'user', tags: ['infrastructure'] },
    );

    // Retrieve from auth context — should find auth content with highest score,
    // but also surface related content from parent and siblings
    const result = await oc.retrieve('How should I validate tokens?', auth.id, {
      maxResults: 10,
    });

    expect(result.units.length).toBeGreaterThan(0);
    expect(result.scopesSearched.length).toBeGreaterThan(1); // Should search beyond just auth

    // Verify scope weighting
    const selfScopes = result.scopesSearched.filter((s) => s.relationship === 'self');
    expect(selfScopes).toHaveLength(1);
    expect(selfScopes[0].weight).toBe(1.0);
  });

  it('pipeline run with retrieve-and-process profile', async () => {
    const oc = new OpenContext({
      embedder: new DeterministicEmbedder(64),
    });

    const ctx = await oc.createContext({
      name: 'Test',
      description: 'Test context',
    });

    // Pre-populate
    await oc.acquire('Always use HTTPS for API calls.', ctx.id);
    await oc.acquire('The database connection string is stored in environment variables.', ctx.id);

    // Run pipeline
    const output = await oc.run({
      query: 'What security practices should I follow?',
      contextId: ctx.id,
      profile: 'retrieve-and-process',
    });

    expect(output.retrievedUnits.length).toBeGreaterThan(0);
    expect(output.agentOutput).toBeDefined();
    expect(output.agentOutput!.response).toContain('NoopAgent');
  });

  it('acquire-only profile ingests without processing', async () => {
    const oc = new OpenContext({
      embedder: new DeterministicEmbedder(64),
    });

    const ctx = await oc.createContext({
      name: 'Ingest Test',
      description: 'Test ingestion',
    });

    const output = await oc.run({
      content: 'Never commit secrets to version control. Use environment variables instead.',
      contextId: ctx.id,
      profile: 'acquire-only',
    });

    expect(output.acquiredUnits.length).toBeGreaterThan(0);
    expect(output.agentOutput).toBeUndefined();

    // Verify content is now retrievable
    const result = await oc.retrieve('How to handle secrets?', ctx.id);
    expect(result.units.length).toBeGreaterThan(0);
  });

  it('save and load round-trips data', async () => {
    const oc = new OpenContext({
      embedder: new DeterministicEmbedder(64),
    });

    const ctx = await oc.createContext({
      name: 'Persist Test',
      description: 'Test persistence',
    });

    await oc.acquire('Important fact to remember.', ctx.id);

    const path = './test-data-tmp.json';
    await oc.save(path);

    // Create a new instance and load
    const oc2 = new OpenContext({
      embedder: new DeterministicEmbedder(64),
    });
    await oc2.load(path);

    const result = await oc2.retrieve('What should I remember?', ctx.id);
    expect(result.units.length).toBeGreaterThan(0);
    expect(result.units[0].unit.content).toContain('Important fact');

    // Cleanup
    const fs = await import('fs/promises');
    await fs.unlink(path).catch(() => {});
  });

  it('usage tracking records retrieval and inclusion', async () => {
    const oc = new OpenContext({
      embedder: new DeterministicEmbedder(64),
    });

    const ctx = await oc.createContext({
      name: 'Usage Test',
      description: 'Test usage tracking',
    });

    const units = await oc.acquire('Track this unit usage.', ctx.id);
    const unitId = units[0].id;

    // Retrieve twice
    await oc.retrieve('usage', ctx.id);
    await oc.retrieve('track', ctx.id);

    const unit = await oc.unitStore.get(unitId);
    expect(unit!.usage.retrievalCount).toBeGreaterThanOrEqual(2);
  });
});
