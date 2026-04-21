import { describe, it, expect } from 'vitest';
import {
  extractEnumConstraints,
  buildMinimalExample,
} from '../src/execution/agent-executor.js';

// ── extractEnumConstraints ────────────────────────────────────────────────

describe('extractEnumConstraints', () => {
  it('extracts top-level enum', () => {
    const schema = { enum: ['a', 'b', 'c'] };
    expect(extractEnumConstraints(schema)).toEqual([
      { path: '$', values: ['a', 'b', 'c'] },
    ]);
  });

  it('extracts enum from nested property', () => {
    const schema = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'fail'] },
      },
    };
    const result = extractEnumConstraints(schema);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('status');
    expect(result[0].values).toEqual(['ok', 'fail']);
  });

  it('extracts enum inside array items', () => {
    const schema = {
      type: 'object',
      properties: {
        matches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { enum: ['resource-type', 'resource'] },
            },
          },
        },
      },
    };
    const result = extractEnumConstraints(schema);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('matches[].kind');
    expect(result[0].values).toEqual(['resource-type', 'resource']);
  });

  it('extracts multiple enums from deeply nested schema', () => {
    const schema = {
      type: 'object',
      properties: {
        level: { enum: ['low', 'medium', 'high'] },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { enum: ['a', 'b'] },
              priority: { enum: ['p1', 'p2', 'p3'] },
            },
          },
        },
      },
    };
    const result = extractEnumConstraints(schema);
    expect(result).toHaveLength(3);
    const paths = result.map((r) => r.path);
    expect(paths).toContain('level');
    expect(paths).toContain('items[].kind');
    expect(paths).toContain('items[].priority');
  });

  it('skips non-string enums', () => {
    const schema = {
      type: 'object',
      properties: {
        flag: { enum: [true, false] },
      },
    };
    expect(extractEnumConstraints(schema)).toEqual([]);
  });

  it('returns empty array when no enums exist', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
    };
    expect(extractEnumConstraints(schema)).toEqual([]);
  });
});

// ── buildMinimalExample ───────────────────────────────────────────────────

describe('buildMinimalExample', () => {
  it('builds object with required fields only', () => {
    const schema = {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        optional: { type: 'string' },
      },
    };
    const ex = buildMinimalExample(schema) as Record<string, unknown>;
    expect(ex).toHaveProperty('name');
    expect(ex).not.toHaveProperty('optional');
  });

  it('uses first enum value where an enum is specified', () => {
    const schema = {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: { enum: ['first-value', 'second-value'] },
      },
    };
    const ex = buildMinimalExample(schema) as Record<string, unknown>;
    expect(ex.kind).toBe('first-value');
  });

  it('produces array with one element matching items schema', () => {
    const schema = {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    };
    const ex = buildMinimalExample(schema) as Record<string, unknown>;
    expect(Array.isArray(ex.items)).toBe(true);
    expect((ex.items as unknown[]).length).toBe(1);
  });

  it('handles nested objects with required fields', () => {
    const schema = {
      type: 'object',
      required: ['user'],
      properties: {
        user: {
          type: 'object',
          required: ['id', 'kind'],
          properties: {
            id: { type: 'string' },
            kind: { enum: ['admin', 'guest'] },
          },
        },
      },
    };
    const ex = buildMinimalExample(schema) as any;
    expect(ex.user).toBeDefined();
    expect(typeof ex.user.id).toBe('string');
    expect(ex.user.kind).toBe('admin');
  });

  it('uses minimum as bound for numbers with range', () => {
    const schema = {
      type: 'object',
      required: ['score'],
      properties: {
        score: { type: 'number', minimum: 0, maximum: 1 },
      },
    };
    const ex = buildMinimalExample(schema) as Record<string, unknown>;
    expect(ex.score).toBe(0.5); // midpoint of 0 and 1
  });

  it('returns true for boolean types', () => {
    const schema = {
      type: 'object',
      required: ['active'],
      properties: { active: { type: 'boolean' } },
    };
    const ex = buildMinimalExample(schema) as Record<string, unknown>;
    expect(ex.active).toBe(true);
  });

  it('produces valid example for a realistic meta-action schema', () => {
    // This mirrors CLASSIFICATION_SCHEMA from meta-actions.ts
    const schema = {
      type: 'object',
      required: ['matches', 'gaps'],
      properties: {
        matches: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'kind', 'relevance'],
            properties: {
              id: { type: 'string' },
              kind: {
                type: 'string',
                enum: ['resource-type', 'resource', 'relationship-type', 'relationship'],
              },
              relevance: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
        gaps: {
          type: 'array',
          items: {
            type: 'object',
            required: ['concept'],
            properties: {
              concept: { type: 'string' },
            },
          },
        },
      },
    };
    const ex = buildMinimalExample(schema) as any;
    expect(ex).toHaveProperty('matches');
    expect(ex).toHaveProperty('gaps');
    expect(ex.matches.length).toBe(1);
    expect(ex.matches[0].kind).toBe('resource-type'); // first enum value
    expect(typeof ex.matches[0].relevance).toBe('number');
    expect(ex.gaps.length).toBe(1);
    expect(typeof ex.gaps[0].concept).toBe('string');
  });
});
