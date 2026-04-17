/**
 * Domain and Action Storage Helpers
 *
 * Stores ResourceTypes, Resources, RelationshipTypes, Relationships, and
 * ActionDefinitions as semantic units in the knowledge base.
 *
 * Each stored object combines:
 * - A natural-language description (for vector embedding and retrieval)
 * - A structured JSON block (for type-safe deserialization)
 *
 * The structured content is preserved in the unit's content as a marked
 * code block, while the description above it gets embedded for retrieval.
 */

import type {
  ResourceType,
  Resource,
  RelationshipType,
  Relationship,
} from './domain-model.js';
import type { ActionDefinition } from './action-model.js';
import type { SemanticUnit, AcquireOptions, ContentType } from '../core/types.js';
import type { AcquisitionDeps } from '../acquisition/acquire.js';
import { acquireContent } from '../acquisition/acquire.js';
import type { UnitStore } from '../storage/unit-store.js';

// ---------------------------------------------------------------------------
// Content format
// ---------------------------------------------------------------------------

const STRUCTURED_MARKER = '\n---STRUCTURED---\n';

/**
 * Build the unit content combining description and structured JSON.
 */
function formatUnitContent(description: string, structured: unknown): string {
  return `${description}${STRUCTURED_MARKER}${JSON.stringify(structured, null, 2)}`;
}

/**
 * Parse a unit's content to extract the structured JSON portion.
 */
function parseUnitContent<T>(content: string): T | null {
  const idx = content.indexOf(STRUCTURED_MARKER);
  if (idx === -1) return null;
  try {
    return JSON.parse(content.substring(idx + STRUCTURED_MARKER.length)) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ResourceType storage
// ---------------------------------------------------------------------------

/**
 * Build a natural-language description for a ResourceType (for embedding).
 */
function describeResourceType(rt: ResourceType): string {
  const parts: string[] = [
    `ResourceType: ${rt.name}.`,
    `Domain: ${rt.domain}.`,
    rt.description,
  ];

  if (rt.properties.length > 0) {
    const propDescs = rt.properties.map((p) => {
      const typeStr = describePropertyType(p.type);
      return `${p.name} (${typeStr})${p.optional ? ' optional' : ''}`;
    });
    parts.push(`Properties: ${propDescs.join(', ')}.`);
  }

  if (rt.quantity) {
    parts.push(
      `Quantifiable in ${rt.quantity.unit}${rt.quantity.fungible ? ' (fungible)' : ''}.`,
    );
  }

  if (rt.isAggregate) {
    parts.push('This is an aggregate type that groups other resources.');
  }

  return parts.join(' ');
}

function describePropertyType(pt: { kind: string; [k: string]: unknown }): string {
  if (pt.kind === 'primitive') return String(pt['type']);
  if (pt.kind === 'enum') return `enum[${(pt['values'] as string[]).join('|')}]`;
  if (pt.kind === 'list') return 'list';
  if (pt.kind === 'object') return 'object';
  if (pt.kind === 'union') return 'union';
  return pt.kind;
}

export async function acquireResourceType(
  rt: ResourceType,
  contextId: string,
  deps: AcquisitionDeps,
  options?: Partial<AcquireOptions>,
): Promise<SemanticUnit[]> {
  const description = describeResourceType(rt);
  const content = formatUnitContent(description, rt);
  return acquireContent(content, contextId, deps, {
    sourceType: 'system',
    ...options,
    contentType: 'domain-entity',
    tags: ['resource-type', `domain:${rt.domain}`, `type-id:${rt.id}`, ...(rt.tags ?? []), ...(options?.tags ?? [])],
    chunkOptions: { maxChunkSize: 100000, preserveContext: true, noChunking: true },
  });
}

// ---------------------------------------------------------------------------
// Resource storage
// ---------------------------------------------------------------------------

function describeResource(r: Resource): string {
  const parts: string[] = [
    `Resource${r.name ? ` "${r.name}"` : ''} of type ${r.typeId}.`,
  ];

  const propEntries = Object.entries(r.properties);
  if (propEntries.length > 0) {
    const propDescs = propEntries.map(([k, v]) => `${k}=${formatValue(v)}`);
    parts.push(`Properties: ${propDescs.join(', ')}.`);
  }

  if (r.availableQuantity != null) {
    parts.push(`Available quantity: ${r.availableQuantity}.`);
  }

  return parts.join(' ');
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v.length > 50 ? `"${v.substring(0, 50)}..."` : `"${v}"`;
  if (typeof v === 'object') return JSON.stringify(v).substring(0, 50);
  return String(v);
}

export async function acquireResource(
  r: Resource,
  deps: AcquisitionDeps,
  options?: Partial<AcquireOptions>,
): Promise<SemanticUnit[]> {
  const description = describeResource(r);
  const content = formatUnitContent(description, r);
  return acquireContent(content, r.contextId, deps, {
    sourceType: 'system',
    ...options,
    contentType: 'domain-resource',
    tags: ['resource', `type-id:${r.typeId}`, `resource-id:${r.id}`, ...(r.tags ?? []), ...(options?.tags ?? [])],
    chunkOptions: { maxChunkSize: 100000, preserveContext: true, noChunking: true },
  });
}

// ---------------------------------------------------------------------------
// RelationshipType storage
// ---------------------------------------------------------------------------

function describeRelationshipType(rt: RelationshipType): string {
  return [
    `RelationshipType: ${rt.name}.`,
    rt.description,
    `Connects ${rt.sourceTypeId} (${rt.sourceCardinality}) to ${rt.targetTypeId} (${rt.targetCardinality}).`,
  ].join(' ');
}

export async function acquireRelationshipType(
  rt: RelationshipType,
  contextId: string,
  deps: AcquisitionDeps,
  options?: Partial<AcquireOptions>,
): Promise<SemanticUnit[]> {
  const description = describeRelationshipType(rt);
  const content = formatUnitContent(description, rt);
  return acquireContent(content, contextId, deps, {
    sourceType: 'system',
    ...options,
    contentType: 'domain-relationship',
    tags: [
      'relationship-type',
      `rel-type-id:${rt.id}`,
      `source-type:${rt.sourceTypeId}`,
      `target-type:${rt.targetTypeId}`,
      ...(rt.tags ?? []),
      ...(options?.tags ?? []),
    ],
    chunkOptions: { maxChunkSize: 100000, preserveContext: true, noChunking: true },
  });
}

// ---------------------------------------------------------------------------
// Relationship storage
// ---------------------------------------------------------------------------

function describeRelationship(r: Relationship): string {
  return `Relationship of type ${r.typeId}: ${r.sourceId} → ${r.targetId}.`;
}

export async function acquireRelationship(
  r: Relationship,
  contextId: string,
  deps: AcquisitionDeps,
  options?: Partial<AcquireOptions>,
): Promise<SemanticUnit[]> {
  const description = describeRelationship(r);
  const content = formatUnitContent(description, r);
  return acquireContent(content, contextId, deps, {
    sourceType: 'system',
    ...options,
    contentType: 'domain-relationship',
    tags: [
      'relationship',
      `rel-type-id:${r.typeId}`,
      `rel-id:${r.id}`,
      `source-id:${r.sourceId}`,
      `target-id:${r.targetId}`,
      ...(r.tags ?? []),
      ...(options?.tags ?? []),
    ],
    chunkOptions: { maxChunkSize: 100000, preserveContext: true, noChunking: true },
  });
}

// ---------------------------------------------------------------------------
// ActionDefinition storage
// ---------------------------------------------------------------------------

function describeActionDefinition(a: ActionDefinition): string {
  const parts: string[] = [
    `Action: ${a.name}.`,
    a.description,
  ];

  if (a.inputs.length > 0) {
    const inputDescs = a.inputs.map((p) =>
      `${p.name}${p.required ? '' : '?'}: ${p.description}`,
    );
    parts.push(`Inputs: ${inputDescs.join('; ')}.`);
  }

  if (a.outputs.length > 0) {
    const outputDescs = a.outputs.map((p) => `${p.name}: ${p.description}`);
    parts.push(`Produces: ${outputDescs.join('; ')}.`);
  }

  parts.push(`Performed by: ${a.performer.type}.`);

  if (a.alternatives && a.alternatives.length > 0) {
    parts.push(`Alternative actions: ${a.alternatives.join(', ')}.`);
  }

  return parts.join(' ');
}

export async function acquireActionDefinition(
  a: ActionDefinition,
  deps: AcquisitionDeps,
  options?: Partial<AcquireOptions>,
): Promise<SemanticUnit[]> {
  const description = describeActionDefinition(a);
  const content = formatUnitContent(description, a);
  return acquireContent(content, a.contextId, deps, {
    sourceType: 'system',
    ...options,
    contentType: 'action-definition',
    tags: [
      'action',
      `action-id:${a.id}`,
      `performer:${a.performer.type}`,
      ...(a.tags ?? []),
      ...(options?.tags ?? []),
    ],
    chunkOptions: { maxChunkSize: 100000, preserveContext: true, noChunking: true },
  });
}

// ---------------------------------------------------------------------------
// Retrieval helpers — deserialize structured content from semantic units
// ---------------------------------------------------------------------------

export function extractResourceType(unit: SemanticUnit): ResourceType | null {
  if (unit.metadata.contentType !== 'domain-entity') return null;
  return parseUnitContent<ResourceType>(unit.content);
}

export function extractResource(unit: SemanticUnit): Resource | null {
  if (unit.metadata.contentType !== 'domain-resource') return null;
  return parseUnitContent<Resource>(unit.content);
}

export function extractRelationshipType(unit: SemanticUnit): RelationshipType | null {
  if (unit.metadata.contentType !== 'domain-relationship') return null;
  if (!unit.metadata.tags.includes('relationship-type')) return null;
  return parseUnitContent<RelationshipType>(unit.content);
}

export function extractRelationship(unit: SemanticUnit): Relationship | null {
  if (unit.metadata.contentType !== 'domain-relationship') return null;
  if (!unit.metadata.tags.includes('relationship')) return null;
  return parseUnitContent<Relationship>(unit.content);
}

export function extractActionDefinition(unit: SemanticUnit): ActionDefinition | null {
  if (unit.metadata.contentType !== 'action-definition') return null;
  return parseUnitContent<ActionDefinition>(unit.content);
}

// ---------------------------------------------------------------------------
// Lookup helpers — find by type-id or action-id
// ---------------------------------------------------------------------------

export async function findResourceTypeById(
  id: string,
  unitStore: UnitStore,
): Promise<ResourceType | null> {
  const all = await unitStore.getAll();
  for (const unit of all) {
    if (
      unit.metadata.contentType === 'domain-entity' &&
      unit.metadata.tags.includes(`type-id:${id}`)
    ) {
      const rt = extractResourceType(unit);
      if (rt) return rt;
    }
  }
  return null;
}

export async function findResourceById(
  id: string,
  unitStore: UnitStore,
): Promise<Resource | null> {
  const all = await unitStore.getAll();
  for (const unit of all) {
    if (
      unit.metadata.contentType === 'domain-resource' &&
      unit.metadata.tags.includes(`resource-id:${id}`)
    ) {
      const r = extractResource(unit);
      if (r) return r;
    }
  }
  return null;
}

export async function findActionDefinitionById(
  id: string,
  unitStore: UnitStore,
): Promise<ActionDefinition | null> {
  const all = await unitStore.getAll();
  for (const unit of all) {
    if (
      unit.metadata.contentType === 'action-definition' &&
      unit.metadata.tags.includes(`action-id:${id}`)
    ) {
      const a = extractActionDefinition(unit);
      if (a) return a;
    }
  }
  return null;
}

/**
 * List all action definitions, optionally filtered by tags.
 */
export async function listActionDefinitions(
  unitStore: UnitStore,
  options?: { tags?: string[]; contextId?: string },
): Promise<ActionDefinition[]> {
  const all = await unitStore.getAll();
  const actions: ActionDefinition[] = [];

  for (const unit of all) {
    if (unit.metadata.contentType !== 'action-definition') continue;
    if (options?.contextId && unit.contextId !== options.contextId) continue;
    if (options?.tags && !options.tags.every((t) => unit.metadata.tags.includes(t))) continue;

    const a = extractActionDefinition(unit);
    if (a) actions.push(a);
  }

  return actions;
}

/**
 * Find resources by their type ID.
 */
export async function findResourcesByType(
  typeId: string,
  unitStore: UnitStore,
  options?: { contextId?: string },
): Promise<Resource[]> {
  const all = await unitStore.getAll();
  const resources: Resource[] = [];

  for (const unit of all) {
    if (unit.metadata.contentType !== 'domain-resource') continue;
    if (!unit.metadata.tags.includes(`type-id:${typeId}`)) continue;
    if (options?.contextId && unit.contextId !== options.contextId) continue;

    const r = extractResource(unit);
    if (r) resources.push(r);
  }

  return resources;
}
