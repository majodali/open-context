/**
 * Standard tools for agent interaction with the knowledge base.
 *
 * - get_unit_detail: fetch the full content of a specific unit by ID
 * - query_knowledge: perform an additional knowledge query during execution
 *   (its results should be reported in `subsequentQueries` feedback)
 *
 * These tools enable the multi-turn agent execution pattern where the
 * agent can drill into specific units it heard about (in summaries or other
 * units' content) or query for information it discovers it needs mid-task.
 */

import type { ToolDefinition, ToolResult } from './tools.js';
import type { UnitStore } from '../storage/unit-store.js';
import type { Retriever } from '../retrieval/retriever.js';
import type { RetrievalOptions } from '../core/types.js';

// ---------------------------------------------------------------------------
// get_unit_detail
// ---------------------------------------------------------------------------

/**
 * Build a tool that lets agents fetch the full content of a unit by ID.
 * Useful when retrieved context contains references (e.g., "see id:abc12345")
 * or when a unit's content mentions a related unit ID.
 */
export function createGetUnitDetailTool(unitStore: UnitStore): ToolDefinition {
  return {
    name: 'get_unit_detail',
    description:
      'Fetch the full content of a specific knowledge unit by its ID. ' +
      'Use this when you see a reference to a unit (e.g., "id:abc12345") in ' +
      'the provided context and need its full content, or when you want to ' +
      'look up a specific unit you know about. Returns the unit\'s content, ' +
      'metadata (type, tags, source), and contextId.',
    inputSchema: {
      type: 'object',
      properties: {
        unitId: {
          type: 'string',
          description:
            'The unit ID. Can be the full UUID or a short prefix (first 8+ chars) ' +
            'matching a unique unit.',
        },
      },
      required: ['unitId'],
    },
    execute: async (args): Promise<ToolResult> => {
      const requested = String(args['unitId'] ?? '').trim();
      if (!requested) {
        return { success: false, content: '', error: 'No unitId provided' };
      }

      // Try exact match first
      let unit = await unitStore.get(requested);

      // Fall back to prefix match if exact not found
      if (!unit && requested.length >= 8) {
        const all = await unitStore.getAll();
        const matches = all.filter((u) => u.id.startsWith(requested));
        if (matches.length === 1) {
          unit = matches[0];
        } else if (matches.length > 1) {
          return {
            success: false,
            content: '',
            error: `Ambiguous prefix '${requested}' matches ${matches.length} units. Use more characters.`,
          };
        }
      }

      if (!unit) {
        return {
          success: false,
          content: '',
          error: `Unit '${requested}' not found`,
        };
      }

      return {
        success: true,
        content: {
          id: unit.id,
          contextId: unit.contextId,
          contentType: unit.metadata.contentType,
          tags: unit.metadata.tags,
          source: unit.metadata.source,
          content: unit.content,
        },
      };
    },
    tags: ['standard', 'knowledge'],
  };
}

// ---------------------------------------------------------------------------
// query_knowledge
// ---------------------------------------------------------------------------

/**
 * Build a tool that lets agents perform additional knowledge queries during
 * execution. The results should be tracked in execution feedback as
 * `subsequentQueries` so the system can learn whether the initial retrieval
 * was insufficient.
 */
export function createQueryKnowledgeTool(
  retriever: Retriever,
  defaultContextId: () => string,
): ToolDefinition {
  return {
    name: 'query_knowledge',
    description:
      'Perform an additional knowledge base query when the initial context ' +
      'is insufficient. Use sparingly — the initial context should usually be ' +
      'sufficient. When you do use this, report the query and which results ' +
      'were useful in your subsequentQueries feedback. Returns up to 10 ' +
      'matching units with their IDs, content, and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The natural-language query.',
        },
        contextId: {
          type: 'string',
          description:
            'Optional bounded context ID to scope the query. Defaults to ' +
            'the current action\'s context.',
        },
        contentTypes: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional content type filter (e.g., ["fact", "rule"]).',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tag filter — units must have at least one.',
        },
        maxResults: {
          type: 'number',
          description: 'Max results to return (default 10, max 25).',
        },
      },
      required: ['query'],
    },
    execute: async (args, ctx): Promise<ToolResult> => {
      const query = String(args['query'] ?? '').trim();
      if (!query) {
        return { success: false, content: '', error: 'No query provided' };
      }

      const requestedMax = Number(args['maxResults'] ?? 10);
      const maxResults = Math.min(Math.max(1, requestedMax), 25);

      const options: RetrievalOptions = {
        contextId: String(args['contextId'] ?? ctx.contextId ?? defaultContextId()),
        maxResults,
        contentTypes: Array.isArray(args['contentTypes'])
          ? (args['contentTypes'] as any[]).map(String) as any
          : undefined,
        tags: Array.isArray(args['tags'])
          ? (args['tags'] as string[]).map(String)
          : undefined,
      };

      const result = await retriever.retrieve(query, options);

      return {
        success: true,
        content: {
          query,
          results: result.units.map((su) => ({
            id: su.unit.id,
            score: su.score,
            contentType: su.unit.metadata.contentType,
            tags: su.unit.metadata.tags,
            content: su.unit.content,
          })),
          totalReturned: result.units.length,
        },
      };
    },
    tags: ['standard', 'knowledge'],
  };
}
