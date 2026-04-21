/**
 * Walkthrough Scenario Backlog
 *
 * A curated list of scenarios with metadata for tracking what we've tested,
 * what's outstanding, and which ones have proven problematic. Populated
 * over time as we design new scenarios and run them.
 *
 * Goals of the backlog:
 * - Coverage of many domains (well-known and obscure)
 * - Explicit familiarity tracking (so we know when agent success is
 *   genuine vs. training-prior-assisted)
 * - Status tracking (proposed / in-progress / failed / stable)
 * - Failure-pattern notes (scenarios that are hard to improve)
 */

import type { WalkthroughSequence } from './sequence.js';

// ---------------------------------------------------------------------------
// Entry types
// ---------------------------------------------------------------------------

export type ScenarioStatus =
  | 'proposed'      // designed but not yet run
  | 'in-progress'   // actively being developed or iterated on
  | 'stable'        // runs cleanly, produces expected results
  | 'difficult'     // repeatedly causes failures or is hard to improve
  | 'retired';      // no longer useful (superseded, obsolete, etc.)

export type FamiliarityLevel = 'well-known' | 'moderate' | 'obscure';

export interface BacklogEntry {
  /** Stable identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** One-line description of what this scenario tests. */
  description: string;
  /** Domains this scenario spans. */
  domains: string[];
  /** How familiar is this kind of problem to typical training data? */
  familiarity: FamiliarityLevel;
  /** Complexity estimate — rough number of cycles or sub-objectives expected. */
  complexity: 'small' | 'medium' | 'large';
  /** Current status. */
  status: ScenarioStatus;
  /**
   * Why this scenario is in the backlog — what value it adds to testing.
   * Helps us reason about coverage as the backlog grows.
   */
  rationale: string;
  /**
   * Reference to the scenario/sequence implementation (if implemented).
   * Populated when status moves beyond 'proposed'.
   */
  implementation?: () => WalkthroughSequence;
  /**
   * Observations from runs: failures, interesting behaviors, notes for
   * future work. Appended-to over time.
   */
  observations?: string[];
  /** Tags for filtering (e.g., 'cross-domain', 'obscure-domain'). */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Initial backlog
// ---------------------------------------------------------------------------

/**
 * Starting backlog — broad coverage of domains and familiarity levels.
 * Each entry can be implemented in order of priority.
 *
 * Priority heuristic: start with obscure-familiarity scenarios where
 * training-prior assistance is least likely to contaminate results.
 */
export const INITIAL_BACKLOG: BacklogEntry[] = [
  // ── Currently implemented ──
  {
    id: 'spice-rack-parametric',
    name: 'Parametric 3D-printed spice rack',
    description:
      'Design a parametric 3D-printed spice rack that mounts under a kitchen ' +
      'cabinet, adjustable for different jar sizes and cabinet depths.',
    domains: ['physical-engineering', 'cad', 'manufacturing'],
    familiarity: 'moderate',
    complexity: 'medium',
    status: 'in-progress',
    rationale:
      'Custom physical design with real constraints (material selection, DFM for ' +
      'FDM, mounting hardware, parametric CAD). Not a canonical example in training ' +
      'data, so correct answers depend on the corpus. Tests cross-domain retrieval: ' +
      'methodology (V-model, DFM) + physical-engineering + math (parametric sizing).',
    tags: ['physical', 'parametric', 'first-walkthrough'],
  },

  // ── Obscure / low-familiarity scenarios (priority) ──
  {
    id: 'hydroponic-flow-controller',
    name: 'Hydroponic nutrient flow controller',
    description:
      'Design a microcontroller-based NFT (Nutrient Film Technique) flow ' +
      'controller with pH and EC monitoring, dosing pumps, and failure modes.',
    domains: ['physical-engineering', 'process-workflow', 'math'],
    familiarity: 'obscure',
    complexity: 'large',
    status: 'proposed',
    rationale:
      'Niche domain with specific agronomy constraints the model is unlikely ' +
      'to know deeply. Tests control-system design, tolerance analysis, ' +
      'failure mode management, and cross-domain reasoning (physical + process).',
    tags: ['obscure', 'embedded', 'control-systems'],
  },
  {
    id: 'beekeeping-hive-inspection',
    name: 'Beekeeping hive inspection process',
    description:
      'Design a seasonal hive inspection and intervention process for ' +
      'a small apiary, with decision trees for common observations.',
    domains: ['process-workflow', 'project-management'],
    familiarity: 'obscure',
    complexity: 'medium',
    status: 'proposed',
    rationale:
      'Very specific domain knowledge the model has limited exposure to. ' +
      'Tests process definition, decision trees, seasonal scheduling, and ' +
      'working with ambiguous/incomplete knowledge bases.',
    tags: ['obscure', 'process-design'],
  },
  {
    id: 'ceramic-glaze-firing-schedule',
    name: 'Ceramic glaze firing schedule',
    description:
      'Design a kiln firing schedule for a specific cone and glaze combination ' +
      'including ramp rates, holds, and cooling.',
    domains: ['physical-engineering', 'manufacturing', 'math'],
    familiarity: 'obscure',
    complexity: 'small',
    status: 'proposed',
    rationale:
      'Concrete, narrow physical process with specific numerical constraints. ' +
      'Good test of math integration (time/temperature curves) with domain ' +
      'knowledge. Model has some exposure but specific schedules depend on ' +
      'actual kiln and materials.',
    tags: ['obscure', 'numerical'],
  },

  // ── Moderate familiarity ──
  {
    id: 'custom-cnc-enclosure',
    name: 'CNC-milled waterproof sensor enclosure',
    description:
      'Design a small CNC-milled aluminum enclosure for an outdoor sensor ' +
      'node. IP67 rating, thermal considerations, cable gland access.',
    domains: ['physical-engineering', 'cad', 'manufacturing'],
    familiarity: 'moderate',
    complexity: 'medium',
    status: 'proposed',
    rationale:
      'Mechanical design with specific environmental constraints. Tests ' +
      'materials, tolerancing, DFM for subtractive manufacturing, and ' +
      'design-for-assembly considerations.',
    tags: ['physical', 'enclosure'],
  },
  {
    id: 'multi-warehouse-inventory',
    name: 'Multi-warehouse inventory rebalancing',
    description:
      'Design a rebalancing algorithm for a small distribution network — when ' +
      'to transfer stock between warehouses given demand forecasts, transport ' +
      'costs, and lead times.',
    domains: ['math', 'process-workflow', 'project-management'],
    familiarity: 'moderate',
    complexity: 'large',
    status: 'proposed',
    rationale:
      'Optimization problem with domain constraints. Tests math (linear/ ' +
      'integer programming) + process (operational rules) + PM (risk).',
    tags: ['optimization', 'business-logic'],
  },
  {
    id: 'ab-test-design-for-onboarding',
    name: 'A/B test design for a user onboarding flow',
    description:
      'Design an A/B test comparing two onboarding flows, including sample ' +
      'size calculation, success metrics, and stopping rules.',
    domains: ['math', 'sdlc'],
    familiarity: 'moderate',
    complexity: 'medium',
    status: 'proposed',
    rationale:
      'Directly tests cross-domain integration: math (statistical power) + ' +
      'SDLC (frontend instrumentation). Model has general knowledge but ' +
      'specific power calculations depend on parameters in the corpus.',
    tags: ['cross-domain', 'statistics'],
  },

  // ── Well-known (for comparison / baseline; lower priority) ──
  {
    id: 'sdlc-login-endpoint',
    name: 'Implement the login endpoint',
    description:
      'Design and implement the POST /api/v1/auth/login endpoint with tests ' +
      'and documentation.',
    domains: ['sdlc'],
    familiarity: 'well-known',
    complexity: 'medium',
    status: 'proposed',
    rationale:
      'Baseline scenario heavily represented in training data. Useful as a ' +
      'control: if the system does BETTER than a plain Claude call on this, ' +
      'that is a strong signal. Otherwise, we learn nothing about OpenContext\'s ' +
      'value.',
    tags: ['baseline', 'well-known'],
  },
  {
    id: 'sdlc-refactor-auth-for-oauth',
    name: 'Refactor auth for OAuth support',
    description:
      'Plan and implement refactoring the existing JWT auth to support OAuth 2.0 ' +
      'while maintaining backward compatibility.',
    domains: ['sdlc'],
    familiarity: 'well-known',
    complexity: 'large',
    status: 'proposed',
    rationale:
      'Tests incremental change on a known system. Good for testing the ' +
      'accumulation story: does session-5 knowledge of the auth module help?',
    tags: ['well-known', 'refactoring'],
  },

  // ── Cross-domain (interesting mix) ──
  {
    id: 'retrospective-for-physical-project',
    name: 'Retrospective for a physical engineering project',
    description:
      'Run a retrospective on a completed physical design project (e.g., the ' +
      'spice rack after a few iterations), capturing lessons and proposed ' +
      'process improvements.',
    domains: ['project-management', 'physical-engineering'],
    familiarity: 'moderate',
    complexity: 'small',
    status: 'proposed',
    rationale:
      'Tests whether PM methodology (retrospective, lessons-learned) surfaces ' +
      'when applied outside software. Direct test of the cross-domain ' +
      'applicability hypothesis.',
    tags: ['cross-domain', 'methodology'],
  },
  {
    id: 'vmodel-for-firmware',
    name: 'Apply V-model to embedded firmware development',
    description:
      'Plan an embedded firmware project (bootloader + application) using ' +
      'V-model decomposition with appropriate test levels.',
    domains: ['sdlc', 'physical-engineering', 'methodology'],
    familiarity: 'moderate',
    complexity: 'large',
    status: 'proposed',
    rationale:
      'Methodology originally shared between software and hardware/systems ' +
      'engineering. Tests whether V-model surfaces appropriately for a ' +
      'mixed software/hardware project.',
    tags: ['cross-domain', 'methodology'],
  },
];

// ---------------------------------------------------------------------------
// Backlog operations
// ---------------------------------------------------------------------------

export interface BacklogFilter {
  status?: ScenarioStatus | ScenarioStatus[];
  domains?: string[];
  familiarity?: FamiliarityLevel | FamiliarityLevel[];
  tags?: string[];
}

export function filterBacklog(
  backlog: BacklogEntry[],
  filter: BacklogFilter,
): BacklogEntry[] {
  return backlog.filter((entry) => {
    if (filter.status) {
      const allowed = Array.isArray(filter.status) ? filter.status : [filter.status];
      if (!allowed.includes(entry.status)) return false;
    }
    if (filter.domains && filter.domains.length > 0) {
      if (!filter.domains.some((d) => entry.domains.includes(d))) return false;
    }
    if (filter.familiarity) {
      const allowed = Array.isArray(filter.familiarity)
        ? filter.familiarity
        : [filter.familiarity];
      if (!allowed.includes(entry.familiarity)) return false;
    }
    if (filter.tags && filter.tags.length > 0) {
      if (!filter.tags.some((t) => entry.tags?.includes(t))) return false;
    }
    return true;
  });
}

/**
 * Format the backlog as a text table for review.
 */
export function formatBacklog(backlog: BacklogEntry[]): string {
  const lines: string[] = [];
  lines.push('Walkthrough Scenario Backlog');
  lines.push('─'.repeat(100));
  lines.push(
    pad('ID', 32) + pad('Status', 14) + pad('Familiarity', 14) + pad('Complexity', 12) + 'Domains',
  );
  lines.push('─'.repeat(100));
  for (const e of backlog) {
    lines.push(
      pad(e.id, 32)
      + pad(e.status, 14)
      + pad(e.familiarity, 14)
      + pad(e.complexity, 12)
      + e.domains.join(', '),
    );
  }
  lines.push('─'.repeat(100));
  lines.push(`Total: ${backlog.length} scenarios`);

  // By familiarity
  const byFam = new Map<string, number>();
  for (const e of backlog) byFam.set(e.familiarity, (byFam.get(e.familiarity) ?? 0) + 1);
  lines.push(`By familiarity: ${[...byFam.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`);

  // By status
  const byStatus = new Map<string, number>();
  for (const e of backlog) byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);
  lines.push(`By status: ${[...byStatus.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`);

  // Domain coverage
  const domainCoverage = new Set<string>();
  for (const e of backlog) for (const d of e.domains) domainCoverage.add(d);
  lines.push(`Domains covered: ${[...domainCoverage].sort().join(', ')}`);

  return lines.join('\n');
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s.substring(0, width - 1) + ' ';
  return s + ' '.repeat(width - s.length);
}
