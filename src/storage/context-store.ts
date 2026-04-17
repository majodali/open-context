/**
 * Context store interface and in-memory implementation.
 * Manages the bounded context hierarchy.
 */

import type { BoundedContext } from '../core/types.js';

export interface ContextStore {
  createContext(ctx: BoundedContext): Promise<void>;
  getContext(id: string): Promise<BoundedContext | null>;
  updateContext(id: string, updates: Partial<BoundedContext>): Promise<void>;
  deleteContext(id: string): Promise<void>;
  getChildren(id: string): Promise<BoundedContext[]>;
  getAncestors(id: string): Promise<BoundedContext[]>;
  getSiblings(id: string): Promise<BoundedContext[]>;
  getDescendants(id: string): Promise<BoundedContext[]>;
  getRoots(): Promise<BoundedContext[]>;
  getAll(): Promise<BoundedContext[]>;
  clear(): Promise<void>;
}

export class InMemoryContextStore implements ContextStore {
  private contexts = new Map<string, BoundedContext>();

  async createContext(ctx: BoundedContext): Promise<void> {
    if (this.contexts.has(ctx.id)) {
      throw new Error(`Context with id '${ctx.id}' already exists`);
    }
    this.contexts.set(ctx.id, { ...ctx });

    // Update parent's childIds
    if (ctx.parentId) {
      const parent = this.contexts.get(ctx.parentId);
      if (parent && !parent.childIds.includes(ctx.id)) {
        parent.childIds.push(ctx.id);
      }
    }
  }

  async getContext(id: string): Promise<BoundedContext | null> {
    return this.contexts.get(id) ?? null;
  }

  async updateContext(id: string, updates: Partial<BoundedContext>): Promise<void> {
    const existing = this.contexts.get(id);
    if (!existing) throw new Error(`Context '${id}' not found`);
    Object.assign(existing, updates);
  }

  async deleteContext(id: string): Promise<void> {
    const ctx = this.contexts.get(id);
    if (!ctx) return;

    // Remove from parent's childIds
    if (ctx.parentId) {
      const parent = this.contexts.get(ctx.parentId);
      if (parent) {
        parent.childIds = parent.childIds.filter((cid) => cid !== id);
      }
    }

    this.contexts.delete(id);
  }

  async getChildren(id: string): Promise<BoundedContext[]> {
    const ctx = this.contexts.get(id);
    if (!ctx) return [];
    return ctx.childIds
      .map((cid) => this.contexts.get(cid))
      .filter((c): c is BoundedContext => c != null);
  }

  async getAncestors(id: string): Promise<BoundedContext[]> {
    const ancestors: BoundedContext[] = [];
    let current = this.contexts.get(id);
    while (current?.parentId) {
      const parent = this.contexts.get(current.parentId);
      if (!parent) break;
      ancestors.push(parent);
      current = parent;
    }
    return ancestors;
  }

  async getSiblings(id: string): Promise<BoundedContext[]> {
    const ctx = this.contexts.get(id);
    if (!ctx?.parentId) return [];
    const parent = this.contexts.get(ctx.parentId);
    if (!parent) return [];
    return parent.childIds
      .filter((cid) => cid !== id)
      .map((cid) => this.contexts.get(cid))
      .filter((c): c is BoundedContext => c != null);
  }

  async getDescendants(id: string): Promise<BoundedContext[]> {
    const result: BoundedContext[] = [];
    const queue = [id];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const ctx = this.contexts.get(currentId);
      if (!ctx) continue;
      for (const childId of ctx.childIds) {
        const child = this.contexts.get(childId);
        if (child) {
          result.push(child);
          queue.push(childId);
        }
      }
    }
    return result;
  }

  async getRoots(): Promise<BoundedContext[]> {
    return [...this.contexts.values()].filter((c) => !c.parentId);
  }

  async getAll(): Promise<BoundedContext[]> {
    return [...this.contexts.values()];
  }

  async clear(): Promise<void> {
    this.contexts.clear();
  }
}
