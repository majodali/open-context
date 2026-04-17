/**
 * Domain Model
 *
 * Describes the world the system operates in using a type/instance pattern
 * aligned with the SimpleModels metamodel (Node/NodeType, Edge/EdgeType).
 *
 * Four core classes:
 * - ResourceType: defines the shape/schema of a kind of resource
 * - Resource: a concrete instance of a ResourceType
 * - RelationshipType: defines how resource types can relate
 * - Relationship: a concrete connection between specific resources
 *
 * ResourceTypes can represent both identifiable things (a user account, a CAD model)
 * and fungible/quantifiable things (money, materials, electricity). Quantity semantics
 * are expressed through properties on the type and tracked on instances.
 *
 * This model maps naturally to a graph database representation:
 * ResourceTypes and Resources are nodes; RelationshipTypes and Relationships are edges.
 */

// ---------------------------------------------------------------------------
// Property Definitions (aligned with SimpleModels)
// ---------------------------------------------------------------------------

/**
 * Property type definition — what kind of value a property holds.
 * Aligned with SimpleModels' PropertyValueType.
 */
export type PropertyValueType =
  | { kind: 'primitive'; type: 'string' | 'number' | 'boolean' }
  | { kind: 'enum'; values: string[] }
  | { kind: 'list'; elementType: PropertyValueType }
  | { kind: 'object'; fields: Record<string, PropertyValueType> }
  | { kind: 'union'; types: PropertyValueType[] };

export interface PropertyDef {
  name: string;
  type: PropertyValueType;
  description?: string;
  optional?: boolean;
  defaultValue?: unknown;
}

// ---------------------------------------------------------------------------
// Cardinality (aligned with SimpleModels)
// ---------------------------------------------------------------------------

export type Cardinality = '0..1' | '1' | '0..*' | '1..*';

// ---------------------------------------------------------------------------
// ResourceType (schema/type level)
// ---------------------------------------------------------------------------

/**
 * A resource type — defines the shape and constraints of a kind of resource.
 *
 * Examples:
 * - Identifiable: "User" with properties {email, name, role}
 * - Fungible: "PLAFilament" with quantity {unit: "grams"}
 * - Aggregate/Context: "NavigationContext" containing Location, Route, etc.
 */
export interface ResourceType {
  /** Unique identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this type represents. */
  description: string;
  /** Domain this type belongs to. e.g., 'project', 'system', 'manufacturing' */
  domain: string;
  /** Property definitions — the schema for instances. */
  properties: PropertyDef[];
  /**
   * If this resource type is quantifiable/fungible.
   * When set, instances track available quantity rather than identity.
   * e.g., { unit: "grams" } for material, { unit: "USD" } for money
   */
  quantity?: {
    unit: string;
    /** Whether the resource is fungible (any instance is interchangeable). */
    fungible: boolean;
  };
  /**
   * If true, this type is an aggregate that groups other resources
   * via 'contains' relationships. Can be used to model contexts.
   */
  isAggregate?: boolean;
  /** Tags for classification and retrieval. */
  tags: string[];
}

// ---------------------------------------------------------------------------
// Resource (instance level)
// ---------------------------------------------------------------------------

/**
 * A resource — a concrete instance of a ResourceType.
 *
 * For identifiable resources: represents a specific thing.
 * For quantifiable resources: tracks an available amount.
 */
export interface Resource {
  /** Unique instance identifier. */
  id: string;
  /** Human-readable name. */
  name?: string;
  /** The ResourceType this is an instance of. */
  typeId: string;
  /** The bounded context where this resource exists. */
  contextId: string;
  /** Property values (validated against ResourceType.properties). */
  properties: Record<string, unknown>;
  /**
   * For quantifiable resource types: the current amount.
   * Actions consume and produce quantities.
   */
  availableQuantity?: number;
  /** Annotations — freeform metadata. */
  annotations: Record<string, unknown>;
  /** Tags for classification and retrieval. */
  tags: string[];
}

// ---------------------------------------------------------------------------
// RelationshipType (schema/type level)
// ---------------------------------------------------------------------------

/**
 * A relationship type — defines how resource types can relate.
 *
 * Examples:
 * - "User" --owns--> "TodoItem" (1 to 0..*)
 * - "Circuit" --contains--> "Component" (1 to 1..*)
 * - "NavigationContext" --includes--> "Location" (1 to 1)
 */
export interface RelationshipType {
  /** Unique identifier. */
  id: string;
  /** Human-readable name. e.g., "owns", "contains", "depends-on" */
  name: string;
  /** Description of what this relationship means. */
  description: string;
  /** Source ResourceType ID. */
  sourceTypeId: string;
  /** Target ResourceType ID. */
  targetTypeId: string;
  /** How many of this relationship a source can have. */
  sourceCardinality: Cardinality;
  /** How many of this relationship a target can have. */
  targetCardinality: Cardinality;
  /** Additional properties on the relationship type. */
  properties: PropertyDef[];
  /** Tags for classification and retrieval. */
  tags: string[];
}

// ---------------------------------------------------------------------------
// Relationship (instance level)
// ---------------------------------------------------------------------------

/**
 * A relationship — a concrete connection between specific resources.
 *
 * Examples:
 * - Resource "john@example.com" --owns--> Resource "Todo item #42"
 * - Resource "MainCircuit" --contains--> Resource "ResistorR1"
 */
export interface Relationship {
  /** Unique instance identifier. */
  id: string;
  /** The RelationshipType this is an instance of. */
  typeId: string;
  /** Source Resource ID. */
  sourceId: string;
  /** Target Resource ID. */
  targetId: string;
  /** Property values (validated against RelationshipType.properties). */
  properties: Record<string, unknown>;
  /** Annotations — freeform metadata. */
  annotations: Record<string, unknown>;
  /** Tags for classification and retrieval. */
  tags: string[];
}
