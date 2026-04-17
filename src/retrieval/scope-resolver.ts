/**
 * Scope resolver: given a bounded context, determines which contexts to search
 * and with what weight. Weights decay with distance in the hierarchy.
 */

import type { ScopedContext, ScopeRules, DEFAULT_SCOPE_RULES } from '../core/types.js';
import type { ContextStore } from '../storage/context-store.js';

export interface ScopeResolver {
  resolve(contextId: string, store: ContextStore): Promise<ScopedContext[]>;
}

/**
 * Default scope resolver: walks the hierarchy applying weighted decay.
 */
export class DefaultScopeResolver implements ScopeResolver {
  async resolve(contextId: string, store: ContextStore): Promise<ScopedContext[]> {
    const result: ScopedContext[] = [];
    const ctx = await store.getContext(contextId);
    if (!ctx) return result;

    const rules = ctx.scopeRules;

    // Self
    result.push({
      contextId,
      weight: rules.selfWeight,
      relationship: 'self',
      depth: 0,
    });

    // Walk ancestors
    const ancestors = await store.getAncestors(contextId);
    for (let i = 0; i < ancestors.length; i++) {
      const depth = i + 1;
      const weight = this.computeWeight(
        i === 0 ? rules.parentWeight : rules.parentWeight,
        rules.depthDecay,
        depth,
        rules.minWeight,
      );
      result.push({
        contextId: ancestors[i].id,
        weight,
        relationship: i === 0 ? 'parent' : 'ancestor',
        depth,
      });
    }

    // Siblings
    const siblings = await store.getSiblings(contextId);
    for (const sibling of siblings) {
      result.push({
        contextId: sibling.id,
        weight: Math.max(rules.siblingWeight, rules.minWeight),
        relationship: 'sibling',
        depth: 1,
      });
    }

    // Children and descendants
    const descendants = await this.getDescendantsWithDepth(contextId, store);
    for (const { id, depth } of descendants) {
      const weight = this.computeWeight(
        rules.childWeight,
        rules.depthDecay,
        depth,
        rules.minWeight,
      );
      result.push({
        contextId: id,
        weight,
        relationship: depth === 1 ? 'child' : 'descendant',
        depth,
      });
    }

    return result;
  }

  private computeWeight(
    baseWeight: number,
    decay: number,
    depth: number,
    minWeight: number,
  ): number {
    // Weight = baseWeight * (decay ^ (depth - 1)), floored at minWeight
    const w = baseWeight * Math.pow(decay, Math.max(0, depth - 1));
    return Math.max(w, minWeight);
  }

  private async getDescendantsWithDepth(
    contextId: string,
    store: ContextStore,
  ): Promise<{ id: string; depth: number }[]> {
    const result: { id: string; depth: number }[] = [];
    const queue: { id: string; depth: number }[] = [{ id: contextId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      const children = await store.getChildren(id);
      for (const child of children) {
        const childDepth = depth + 1;
        result.push({ id: child.id, depth: childDepth });
        queue.push({ id: child.id, depth: childDepth });
      }
    }

    return result;
  }
}
