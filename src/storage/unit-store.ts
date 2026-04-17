/**
 * Unit store interface and in-memory implementation.
 * Manages SemanticUnit CRUD and usage tracking.
 */

import type { SemanticUnit, OutcomeSignal } from '../core/types.js';

export interface UnitStore {
  add(unit: SemanticUnit): Promise<void>;
  get(id: string): Promise<SemanticUnit | null>;
  update(id: string, updates: Partial<SemanticUnit>): Promise<void>;
  delete(id: string): Promise<void>;
  getByContext(contextId: string): Promise<SemanticUnit[]>;
  getByContexts(contextIds: string[]): Promise<SemanticUnit[]>;
  recordUsage(
    id: string,
    type: 'retrieval' | 'inclusion',
    signal?: OutcomeSignal,
  ): Promise<void>;
  getAll(): Promise<SemanticUnit[]>;
  clear(): Promise<void>;
}

export class InMemoryUnitStore implements UnitStore {
  private units = new Map<string, SemanticUnit>();
  /** Index: contextId → set of unit IDs */
  private contextIndex = new Map<string, Set<string>>();

  async add(unit: SemanticUnit): Promise<void> {
    this.units.set(unit.id, { ...unit });
    if (!this.contextIndex.has(unit.contextId)) {
      this.contextIndex.set(unit.contextId, new Set());
    }
    this.contextIndex.get(unit.contextId)!.add(unit.id);
  }

  async get(id: string): Promise<SemanticUnit | null> {
    return this.units.get(id) ?? null;
  }

  async update(id: string, updates: Partial<SemanticUnit>): Promise<void> {
    const existing = this.units.get(id);
    if (!existing) throw new Error(`Unit '${id}' not found`);

    // Handle context change
    if (updates.contextId && updates.contextId !== existing.contextId) {
      this.contextIndex.get(existing.contextId)?.delete(id);
      if (!this.contextIndex.has(updates.contextId)) {
        this.contextIndex.set(updates.contextId, new Set());
      }
      this.contextIndex.get(updates.contextId)!.add(id);
    }

    Object.assign(existing, updates);
  }

  async delete(id: string): Promise<void> {
    const unit = this.units.get(id);
    if (unit) {
      this.contextIndex.get(unit.contextId)?.delete(id);
      this.units.delete(id);
    }
  }

  async getByContext(contextId: string): Promise<SemanticUnit[]> {
    const ids = this.contextIndex.get(contextId);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.units.get(id))
      .filter((u): u is SemanticUnit => u != null);
  }

  async getByContexts(contextIds: string[]): Promise<SemanticUnit[]> {
    const result: SemanticUnit[] = [];
    for (const ctxId of contextIds) {
      const ids = this.contextIndex.get(ctxId);
      if (!ids) continue;
      for (const id of ids) {
        const unit = this.units.get(id);
        if (unit) result.push(unit);
      }
    }
    return result;
  }

  async recordUsage(
    id: string,
    type: 'retrieval' | 'inclusion',
    signal?: OutcomeSignal,
  ): Promise<void> {
    const unit = this.units.get(id);
    if (!unit) return;

    const now = Date.now();
    if (type === 'retrieval') {
      unit.usage.retrievalCount++;
      unit.usage.lastRetrievedAt = now;
    } else {
      unit.usage.inclusionCount++;
      unit.usage.lastIncludedAt = now;
    }

    if (signal) {
      unit.usage.outcomeSignals.push(signal);
    }
  }

  async getAll(): Promise<SemanticUnit[]> {
    return [...this.units.values()];
  }

  async clear(): Promise<void> {
    this.units.clear();
    this.contextIndex.clear();
  }
}
