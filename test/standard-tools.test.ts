import { describe, it, expect } from 'vitest';
import {
  OpenContext,
  DeterministicEmbedder,
  VectorRetriever,
  createGetUnitDetailTool,
  createQueryKnowledgeTool,
  parseFeedback,
} from '../src/index.js';
import type { ExecutionFeedback } from '../src/index.js';

// ── get_unit_detail ────────────────────────────────────────────────────────

describe('get_unit_detail tool', () => {
  it('fetches unit by full ID', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });
    const units = await oc.acquire('Important fact about widgets', ctx.id, {
      tags: ['domain:widget'],
    });
    const unitId = units[0].id;

    const tool = createGetUnitDetailTool(oc.unitStore);
    const result = await tool.execute(
      { unitId },
      { actionId: 'a', contextId: ctx.id },
    );

    expect(result.success).toBe(true);
    const content = result.content as any;
    expect(content.id).toBe(unitId);
    expect(content.content).toContain('widgets');
    expect(content.tags).toContain('domain:widget');
  });

  it('fetches unit by 8-char prefix', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });
    const units = await oc.acquire('Sample content', ctx.id);
    const prefix = units[0].id.substring(0, 8);

    const tool = createGetUnitDetailTool(oc.unitStore);
    const result = await tool.execute(
      { unitId: prefix },
      { actionId: 'a', contextId: ctx.id },
    );

    expect(result.success).toBe(true);
    expect((result.content as any).id).toBe(units[0].id);
  });

  it('returns error for unknown unit', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const tool = createGetUnitDetailTool(oc.unitStore);
    const result = await tool.execute(
      { unitId: 'nonexistent-id' },
      { actionId: 'a', contextId: 'c' },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error for missing unitId', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const tool = createGetUnitDetailTool(oc.unitStore);
    const result = await tool.execute({}, { actionId: 'a', contextId: 'c' });
    expect(result.success).toBe(false);
  });
});

// ── query_knowledge ────────────────────────────────────────────────────────

describe('query_knowledge tool', () => {
  it('performs a knowledge query and returns results', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });
    await oc.acquire('Authentication uses JWT tokens', ctx.id, {
      tags: ['domain:auth'],
    });
    await oc.acquire('Database is PostgreSQL', ctx.id, {
      tags: ['domain:database'],
    });

    const retriever = new VectorRetriever({
      embedder: oc.embedder,
      vectorStore: oc.vectorStore,
      unitStore: oc.unitStore,
      contextStore: oc.contextStore,
      scopeResolver: oc.scopeResolver,
    });

    const tool = createQueryKnowledgeTool(retriever, () => ctx.id);
    const result = await tool.execute(
      { query: 'authentication tokens' },
      { actionId: 'a', contextId: ctx.id },
    );

    expect(result.success).toBe(true);
    const content = result.content as any;
    expect(content.query).toBe('authentication tokens');
    expect(content.results).toBeInstanceOf(Array);
    expect(content.results.length).toBeGreaterThan(0);
    expect(content.results[0]).toHaveProperty('id');
    expect(content.results[0]).toHaveProperty('score');
    expect(content.results[0]).toHaveProperty('content');
  });

  it('respects maxResults cap', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    for (let i = 0; i < 30; i++) {
      await oc.acquire(`Fact number ${i}`, ctx.id);
    }

    const retriever = new VectorRetriever({
      embedder: oc.embedder,
      vectorStore: oc.vectorStore,
      unitStore: oc.unitStore,
      contextStore: oc.contextStore,
      scopeResolver: oc.scopeResolver,
    });

    const tool = createQueryKnowledgeTool(retriever, () => ctx.id);

    // Default max should be 10
    const r1 = await tool.execute(
      { query: 'fact' },
      { actionId: 'a', contextId: ctx.id },
    );
    expect((r1.content as any).results.length).toBeLessThanOrEqual(10);

    // Explicit higher request capped at 25
    const r2 = await tool.execute(
      { query: 'fact', maxResults: 100 },
      { actionId: 'a', contextId: ctx.id },
    );
    expect((r2.content as any).results.length).toBeLessThanOrEqual(25);
  });

  it('applies content type filter', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });
    await oc.acquire('JWT validation rule', ctx.id, { contentType: 'rule' });
    await oc.acquire('JWT description fact', ctx.id, { contentType: 'fact' });

    const retriever = new VectorRetriever({
      embedder: oc.embedder,
      vectorStore: oc.vectorStore,
      unitStore: oc.unitStore,
      contextStore: oc.contextStore,
      scopeResolver: oc.scopeResolver,
    });

    const tool = createQueryKnowledgeTool(retriever, () => ctx.id);
    const result = await tool.execute(
      { query: 'JWT', contentTypes: ['rule'] },
      { actionId: 'a', contextId: ctx.id },
    );

    const results = (result.content as any).results as any[];
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.contentType).toBe('rule');
    }
  });

  it('returns error for missing query', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });
    const retriever = new VectorRetriever({
      embedder: oc.embedder,
      vectorStore: oc.vectorStore,
      unitStore: oc.unitStore,
      contextStore: oc.contextStore,
      scopeResolver: oc.scopeResolver,
    });

    const tool = createQueryKnowledgeTool(retriever, () => ctx.id);
    const result = await tool.execute({}, { actionId: 'a', contextId: ctx.id });
    expect(result.success).toBe(false);
  });
});

// ── Extended feedback parsing ───────────────────────────────────────────────

describe('Extended feedback parsing', () => {
  it('parses subsequentQueries, foundViaFollowUp, failureToFind', () => {
    const response = `Did the work.

---FEEDBACK---
{
  "contextQuality": "mostly-sufficient",
  "usedUnits": [],
  "unusedUnits": [],
  "missingInformation": [],
  "subsequentQueries": [
    {"query": "JWT signing key location", "reason": "needed for impl", "unitsReturned": ["abc12345", "def67890"], "unitsUsed": ["abc12345"], "effective": true}
  ],
  "foundViaFollowUp": [
    {"unitId": "abc12345", "viaQuery": "JWT signing key location", "importance": 0.9, "detail": "essential rule that should have been in initial context"}
  ],
  "failureToFind": [
    {"description": "documentation about HSM key rotation", "attemptedQueries": ["HSM rotation", "key rotation policy"], "diagnosis": "missing-knowledge", "severity": "minor-inconvenience"}
  ]
}`;

    const fb = parseFeedback(response, 'action-1', 'node-1');
    expect(fb).not.toBeNull();
    expect(fb!.subsequentQueries).toHaveLength(1);
    expect(fb!.subsequentQueries[0].unitsReturned).toEqual(['abc12345', 'def67890']);
    expect(fb!.subsequentQueries[0].unitsUsed).toEqual(['abc12345']);
    expect(fb!.foundViaFollowUp).toHaveLength(1);
    expect(fb!.foundViaFollowUp[0].importance).toBe(0.9);
    expect(fb!.failureToFind).toHaveLength(1);
    expect(fb!.failureToFind[0].diagnosis).toBe('missing-knowledge');
    expect(fb!.failureToFind[0].attemptedQueries).toHaveLength(2);
  });

  it('falls back gracefully when fields are missing', () => {
    const response = `Done.

---FEEDBACK---
{
  "contextQuality": "sufficient",
  "usedUnits": [],
  "unusedUnits": [],
  "missingInformation": []
}`;

    const fb = parseFeedback(response, 'a');
    expect(fb).not.toBeNull();
    expect(fb!.subsequentQueries).toEqual([]);
    expect(fb!.foundViaFollowUp).toEqual([]);
    expect(fb!.failureToFind).toEqual([]);
  });

  it('converts legacy additionalQueries format', () => {
    // Older agents/data may still send additionalQueries
    const response = `Done.

---FEEDBACK---
{
  "contextQuality": "sufficient",
  "usedUnits": [],
  "unusedUnits": [],
  "missingInformation": [],
  "additionalQueries": [
    {"query": "test query", "reason": "needed", "effective": true, "usefulUnitsFound": 3}
  ]
}`;

    const fb = parseFeedback(response, 'a');
    expect(fb!.subsequentQueries).toHaveLength(1);
    expect(fb!.subsequentQueries[0].query).toBe('test query');
    expect(fb!.subsequentQueries[0].effective).toBe(true);
    // Legacy format doesn't carry unit IDs, so these are empty
    expect(fb!.subsequentQueries[0].unitsReturned).toEqual([]);
    expect(fb!.subsequentQueries[0].unitsUsed).toEqual([]);
  });
});
