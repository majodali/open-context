/**
 * ConfigResolver: queries the knowledge base for configuration units
 * and resolves them into usable configuration objects.
 *
 * Configuration is stored as semantic units with contentType 'configuration'.
 * The resolver finds the latest (non-superseded) configuration for a given
 * context and config key, and parses it.
 *
 * Configuration units use a structured format in their content:
 *   key: <config-key>
 *   value: <JSON-encoded value>
 *
 * Or for simple values:
 *   <config-key> = <value>
 *
 * Tags are used for config namespacing: e.g. ['config:scope-rules', 'config:pipeline']
 */

import type { SemanticUnit, ContentType } from './types.js';
import type { UnitStore } from '../storage/unit-store.js';

export interface ConfigEntry {
  key: string;
  value: unknown;
  unit: SemanticUnit;
}

export class ConfigResolver {
  constructor(private unitStore: UnitStore) {}

  /**
   * Get all active (non-superseded) configuration units for a context.
   */
  async getConfigs(contextId: string): Promise<ConfigEntry[]> {
    const units = await this.unitStore.getByContext(contextId);
    const configUnits = units.filter(
      (u) => u.metadata.contentType === 'configuration',
    );

    // Build supersedes index to exclude superseded units
    const supersededIds = new Set<string>();
    for (const unit of configUnits) {
      if (unit.metadata.supersedes) {
        supersededIds.add(unit.metadata.supersedes);
      }
    }

    const active = configUnits.filter((u) => !supersededIds.has(u.id));

    return active.map((u) => this.parseConfigUnit(u)).filter((e): e is ConfigEntry => e !== null);
  }

  /**
   * Get a specific config value by key within a context.
   * Returns the value from the most recent non-superseded config unit.
   */
  async getConfig(contextId: string, key: string): Promise<unknown | undefined> {
    const configs = await this.getConfigs(contextId);
    const matching = configs.filter((c) => c.key === key);

    if (matching.length === 0) return undefined;

    // Return the most recent
    matching.sort((a, b) => b.unit.metadata.updatedAt - a.unit.metadata.updatedAt);
    return matching[0].value;
  }

  /**
   * Get all config values matching a tag pattern.
   */
  async getConfigsByTag(contextId: string, tag: string): Promise<ConfigEntry[]> {
    const configs = await this.getConfigs(contextId);
    return configs.filter((c) => c.unit.metadata.tags.includes(tag));
  }

  /**
   * Resolve configs up the hierarchy — starts at the given context,
   * walks to ancestors, and merges configs. Closer contexts take precedence.
   */
  async resolveHierarchical(
    contextId: string,
    contextStore: { getAncestors(id: string): Promise<{ id: string }[]> },
  ): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();

    // Get ancestors (root first)
    const ancestors = await contextStore.getAncestors(contextId);
    const contextIds = [...ancestors.map((a) => a.id).reverse(), contextId];

    // Apply configs from root → leaf (later overrides earlier)
    for (const ctxId of contextIds) {
      const configs = await this.getConfigs(ctxId);
      for (const config of configs) {
        result.set(config.key, config.value);
      }
    }

    return result;
  }

  /**
   * Parse a configuration unit's content into a key-value pair.
   */
  private parseConfigUnit(unit: SemanticUnit): ConfigEntry | null {
    const content = unit.content.trim();

    // Try "key: value" format (JSON value)
    const colonMatch = content.match(/^([^:]+):\s*(.+)$/s);
    if (colonMatch) {
      const key = colonMatch[1].trim();
      const rawValue = colonMatch[2].trim();
      try {
        return { key, value: JSON.parse(rawValue), unit };
      } catch {
        return { key, value: rawValue, unit };
      }
    }

    // Try "key = value" format
    const equalsMatch = content.match(/^([^=]+)=\s*(.+)$/s);
    if (equalsMatch) {
      const key = equalsMatch[1].trim();
      const rawValue = equalsMatch[2].trim();
      try {
        return { key, value: JSON.parse(rawValue), unit };
      } catch {
        return { key, value: rawValue, unit };
      }
    }

    // Use the first tag starting with "config:" as the key, content as value
    const configTag = unit.metadata.tags.find((t) => t.startsWith('config:'));
    if (configTag) {
      const key = configTag.replace('config:', '');
      try {
        return { key, value: JSON.parse(content), unit };
      } catch {
        return { key, value: content, unit };
      }
    }

    return null;
  }
}
