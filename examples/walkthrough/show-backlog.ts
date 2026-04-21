/**
 * Print the scenario backlog.
 *
 * Usage:
 *   npx tsx examples/walkthrough/show-backlog.ts
 *   npx tsx examples/walkthrough/show-backlog.ts --status=proposed
 *   npx tsx examples/walkthrough/show-backlog.ts --familiarity=obscure
 *   npx tsx examples/walkthrough/show-backlog.ts --domain=physical-engineering
 */

import {
  INITIAL_BACKLOG,
  filterBacklog,
  formatBacklog,
  type ScenarioStatus,
  type FamiliarityLevel,
} from '../../src/walkthrough/backlog.js';

const args = process.argv.slice(2);
const filter: Record<string, unknown> = {};

for (const arg of args) {
  const match = arg.match(/^--([^=]+)=(.+)$/);
  if (!match) continue;
  const [, key, value] = match;
  switch (key) {
    case 'status':
      filter.status = value as ScenarioStatus;
      break;
    case 'familiarity':
      filter.familiarity = value as FamiliarityLevel;
      break;
    case 'domain':
      filter.domains = [value];
      break;
    case 'tag':
      filter.tags = [value];
      break;
  }
}

const filtered = filterBacklog(INITIAL_BACKLOG, filter);
console.log(formatBacklog(filtered));
