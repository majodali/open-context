import { describe, it, expect } from 'vitest';
import { RecursionGuard } from '../src/index.js';
import type { Objective } from '../src/index.js';

function makeObjective(id: string, description: string): Objective {
  return {
    id,
    name: id,
    description,
    contextId: 'ctx',
    acceptanceCriteria: [],
    isLearningObjective: false,
    priority: 1,
    status: 'defined',
  };
}

describe('RecursionGuard', () => {
  it('allows root objective', () => {
    const guard = new RecursionGuard();
    const lineage = guard.rootLineage();
    const result = guard.check(
      makeObjective('o1', 'Build a web application'),
      lineage,
    );
    expect(result.safe).toBe(true);
  });

  it('allows distinct sub-objectives', () => {
    const guard = new RecursionGuard();
    const root = makeObjective('o-root', 'Build a complete e-commerce system');
    const lineage = guard.childLineage(guard.rootLineage(), root);

    const child = makeObjective('o-auth', 'Implement user authentication');
    const result = guard.check(child, lineage);
    expect(result.safe).toBe(true);
  });

  it('detects duplicate ID', () => {
    const guard = new RecursionGuard();
    const root = makeObjective('o1', 'Build the system');
    const lineage = guard.childLineage(guard.rootLineage(), root);

    const result = guard.check(makeObjective('o1', 'Same id, different desc'), lineage);
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('duplicate-id');
    expect(result.conflictAncestorId).toBe('o1');
  });

  it('detects similar-to-ancestor', () => {
    const guard = new RecursionGuard({ cycleSimilarityThreshold: 0.6 });
    const root = makeObjective('o1', 'Implement the user authentication module with JWT tokens');
    const lineage = guard.childLineage(guard.rootLineage(), root);

    // Very similar restatement
    const result = guard.check(
      makeObjective('o2', 'Implement user authentication with JWT tokens module'),
      lineage,
    );
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('similar-to-ancestor');
    expect(result.conflictAncestorId).toBe('o1');
  });

  it('allows distinct descriptions sharing some words', () => {
    const guard = new RecursionGuard();
    const root = makeObjective(
      'o1',
      'Build the complete authentication system with all features',
    );
    const lineage = guard.childLineage(guard.rootLineage(), root);

    // Shares some words but is a distinct sub-task
    const result = guard.check(
      makeObjective('o2', 'Hash passwords using bcrypt with cost factor 12'),
      lineage,
    );
    expect(result.safe).toBe(true);
  });

  it('enforces maximum depth', () => {
    const guard = new RecursionGuard({ maxDepth: 3 });
    let lineage = guard.rootLineage();

    // Use distinct topical descriptions to avoid triggering similarity check
    const descriptions = [
      'Build complete e-commerce platform supporting global retailers',
      'Implement payment processing with Stripe integration',
      'Configure database connection pooling for production',
      'Investigate connection timeout patterns in monitoring data',
    ];

    for (let i = 0; i < 3; i++) {
      const obj = makeObjective(`o${i}`, descriptions[i]);
      const check = guard.check(obj, lineage);
      expect(check.safe).toBe(true);
      lineage = guard.childLineage(lineage, obj);
    }

    const tooDeep = makeObjective('o-deep', descriptions[3]);
    const result = guard.check(tooDeep, lineage);
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('depth-exceeded');
  });

  it('lineage tracks depth correctly', () => {
    const guard = new RecursionGuard();
    const o1 = makeObjective('o1', 'first');
    const o2 = makeObjective('o2', 'second');

    const root = guard.rootLineage();
    expect(root.depth).toBe(0);

    const child = guard.childLineage(root, o1);
    expect(child.depth).toBe(1);
    expect(child.ancestorIds).toEqual(['o1']);

    const grandchild = guard.childLineage(child, o2);
    expect(grandchild.depth).toBe(2);
    expect(grandchild.ancestorIds).toEqual(['o1', 'o2']);
  });

  it('considers all ancestors, not just direct parent', () => {
    const guard = new RecursionGuard({ cycleSimilarityThreshold: 0.5 });
    const o1 = makeObjective(
      'o1',
      'Design and implement authentication module using JWT tokens',
    );
    const o2 = makeObjective('o2', 'Validate database schema for production deployment');

    let lineage = guard.childLineage(guard.rootLineage(), o1);
    lineage = guard.childLineage(lineage, o2);

    // Trying to create something similar to o1 (the grandparent) should fail
    const result = guard.check(
      makeObjective(
        'o3',
        'Design implement authentication using JWT tokens module again',
      ),
      lineage,
    );
    expect(result.safe).toBe(false);
    expect(result.conflictAncestorId).toBe('o1');
  });
});
