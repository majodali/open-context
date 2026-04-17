import { describe, it, expect } from 'vitest';
import {
  OpenContext,
  DeterministicEmbedder,
  acquireResourceType,
  acquireResource,
  acquireRelationshipType,
  acquireRelationship,
  acquireActionDefinition,
  extractResourceType,
  extractResource,
  extractActionDefinition,
  findResourceTypeById,
  findResourceById,
  findActionDefinitionById,
  listActionDefinitions,
  findResourcesByType,
} from '../src/index.js';
import type {
  ResourceType,
  Resource,
  RelationshipType,
  Relationship,
  ActionDefinition,
} from '../src/index.js';

function getDeps(oc: OpenContext) {
  return {
    chunker: oc.chunker,
    classifier: oc.classifier,
    embedder: oc.embedder,
    vectorStore: oc.vectorStore,
    unitStore: oc.unitStore,
    contextStore: oc.contextStore,
  };
}

describe('Storage helpers', () => {
  it('round-trips a ResourceType', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const rt: ResourceType = {
      id: 'User',
      name: 'User',
      description: 'A user account in the system',
      domain: 'auth',
      properties: [
        { name: 'email', type: { kind: 'primitive', type: 'string' } },
        { name: 'role', type: { kind: 'enum', values: ['admin', 'user'] } },
      ],
      tags: ['core'],
    };

    const units = await acquireResourceType(rt, ctx.id, getDeps(oc));
    expect(units.length).toBeGreaterThan(0);
    expect(units[0].metadata.contentType).toBe('domain-entity');
    expect(units[0].metadata.tags).toContain('type-id:User');

    // Extract back
    const extracted = extractResourceType(units[0]);
    expect(extracted).not.toBeNull();
    expect(extracted!.id).toBe('User');
    expect(extracted!.properties).toHaveLength(2);
    expect(extracted!.properties[1].type).toEqual({ kind: 'enum', values: ['admin', 'user'] });

    // Find by ID
    const found = await findResourceTypeById('User', oc.unitStore);
    expect(found).not.toBeNull();
    expect(found!.id).toBe('User');
  });

  it('round-trips a Resource with quantity', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const r: Resource = {
      id: 'pla-stock',
      name: 'PLA Filament Stock',
      typeId: 'PLAFilament',
      contextId: ctx.id,
      properties: { color: 'black' },
      availableQuantity: 2500,
      annotations: {},
      tags: ['inventory'],
    };

    const units = await acquireResource(r, getDeps(oc));
    expect(units[0].metadata.contentType).toBe('domain-resource');

    const extracted = extractResource(units[0]);
    expect(extracted).not.toBeNull();
    expect(extracted!.availableQuantity).toBe(2500);
    expect(extracted!.properties['color']).toBe('black');

    const found = await findResourceById('pla-stock', oc.unitStore);
    expect(found).not.toBeNull();
  });

  it('round-trips RelationshipType and Relationship', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const rt: RelationshipType = {
      id: 'owns',
      name: 'owns',
      description: 'A user owns a todo item',
      sourceTypeId: 'User',
      targetTypeId: 'TodoItem',
      sourceCardinality: '1',
      targetCardinality: '0..*',
      properties: [],
      tags: [],
    };

    await acquireRelationshipType(rt, ctx.id, getDeps(oc));

    const rel: Relationship = {
      id: 'r1',
      typeId: 'owns',
      sourceId: 'user-1',
      targetId: 'todo-1',
      properties: {},
      annotations: {},
      tags: [],
    };

    const units = await acquireRelationship(rel, ctx.id, getDeps(oc));
    expect(units[0].metadata.tags).toContain('rel-id:r1');
    expect(units[0].metadata.tags).toContain('source-id:user-1');
  });

  it('round-trips an ActionDefinition', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const action: ActionDefinition = {
      id: 'classify-objective',
      name: 'Classify Objective',
      description: 'Identify domain types relevant to an objective',
      contextId: ctx.id,
      inputs: [
        { name: 'description', description: 'The objective description', required: true },
      ],
      outputs: [
        { name: 'classification', description: 'Domain classification', required: true },
      ],
      performer: { type: 'agent', agentConfig: { model: 'claude-sonnet-4-20250514' } },
      instructions: 'Search the domain model and identify relevant types.',
      parameters: [],
      validations: [
        {
          id: 'v1',
          description: 'Output is well-formed',
          method: 'schema',
          schema: { type: 'object', required: ['matches'] },
          blocking: true,
        },
      ],
      riskIndicators: [],
      maxAttempts: 2,
      tags: ['meta-action', 'classification'],
      outputSchema: {
        type: 'object',
        properties: {
          matches: { type: 'array' },
        },
        required: ['matches'],
      },
    };

    const units = await acquireActionDefinition(action, getDeps(oc));
    expect(units[0].metadata.contentType).toBe('action-definition');
    expect(units[0].metadata.tags).toContain('action-id:classify-objective');
    expect(units[0].metadata.tags).toContain('performer:agent');
    expect(units[0].metadata.tags).toContain('meta-action');

    const extracted = extractActionDefinition(units[0]);
    expect(extracted).not.toBeNull();
    expect(extracted!.id).toBe('classify-objective');
    expect(extracted!.validations[0].method).toBe('schema');
    expect(extracted!.outputSchema).toBeDefined();

    const found = await findActionDefinitionById('classify-objective', oc.unitStore);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Classify Objective');
  });

  it('lists action definitions with tag filter', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const make = (id: string, tags: string[]): ActionDefinition => ({
      id,
      name: id,
      description: `Action ${id}`,
      contextId: ctx.id,
      inputs: [],
      outputs: [{ name: 'result', description: 'r', required: true }],
      performer: { type: 'agent' },
      instructions: 'Do.',
      parameters: [],
      validations: [],
      riskIndicators: [],
      maxAttempts: 1,
      tags,
    });

    await acquireActionDefinition(make('a1', ['meta', 'planning']), getDeps(oc));
    await acquireActionDefinition(make('a2', ['meta', 'execution']), getDeps(oc));
    await acquireActionDefinition(make('a3', ['domain', 'auth']), getDeps(oc));

    const all = await listActionDefinitions(oc.unitStore);
    expect(all).toHaveLength(3);

    const meta = await listActionDefinitions(oc.unitStore, { tags: ['meta'] });
    expect(meta).toHaveLength(2);

    const planning = await listActionDefinitions(oc.unitStore, { tags: ['meta', 'planning'] });
    expect(planning).toHaveLength(1);
    expect(planning[0].id).toBe('a1');
  });

  it('finds resources by type', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const make = (id: string, typeId: string): Resource => ({
      id,
      name: id,
      typeId,
      contextId: ctx.id,
      properties: {},
      annotations: {},
      tags: [],
    });

    await acquireResource(make('u1', 'User'), getDeps(oc));
    await acquireResource(make('u2', 'User'), getDeps(oc));
    await acquireResource(make('t1', 'Todo'), getDeps(oc));

    const users = await findResourcesByType('User', oc.unitStore);
    expect(users).toHaveLength(2);

    const todos = await findResourcesByType('Todo', oc.unitStore);
    expect(todos).toHaveLength(1);
  });

  it('description portion is retrievable via semantic search', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({ name: 'Test', description: 'Test' });

    const action: ActionDefinition = {
      id: 'login',
      name: 'Login User',
      description: 'Authenticate a user with email and password, returning JWT tokens',
      contextId: ctx.id,
      inputs: [],
      outputs: [{ name: 'tokens', description: 'JWT tokens', required: true }],
      performer: { type: 'agent' },
      instructions: 'Do it.',
      parameters: [],
      validations: [],
      riskIndicators: [],
      maxAttempts: 1,
      tags: ['auth'],
    };

    await acquireActionDefinition(action, getDeps(oc));

    const result = await oc.retrieve('how to authenticate users with passwords', ctx.id);
    expect(result.units.length).toBeGreaterThan(0);
    // The action should be retrievable via the description text
    const found = result.units.find((su) => su.unit.metadata.contentType === 'action-definition');
    expect(found).toBeDefined();
  });
});
