/**
 * Assembler: takes retrieved units and constructs structured agent input.
 */

import type {
  AssembledInput,
  AssemblyTemplate,
  ScoredUnit,
  TemplateSection,
  PipelineContext,
} from '../core/types.js';
import type { UnitStore } from '../storage/unit-store.js';

export interface Assembler {
  assemble(units: ScoredUnit[], template: AssemblyTemplate): Promise<AssembledInput>;
}

export interface AssemblerDeps {
  unitStore: UnitStore;
}

/** Rough token estimate: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const DEFAULT_TEMPLATE: AssemblyTemplate = {
  id: 'default',
  sections: [
    {
      name: 'instructions',
      contentTypes: ['instruction', 'rule'],
      prefix: '## Instructions\n',
    },
    {
      name: 'context',
      contentTypes: ['fact', 'decision'],
      prefix: '## Context\n',
    },
    {
      name: 'observations',
      contentTypes: ['observation', 'statement'],
      prefix: '## Recent Activity\n',
    },
  ],
  prioritization: 'relevance',
};

export class DefaultAssembler implements Assembler {
  constructor(private deps: AssemblerDeps) {}

  async assemble(
    units: ScoredUnit[],
    template: AssemblyTemplate,
  ): Promise<AssembledInput> {
    // Sort units based on prioritization
    const sorted = this.sortUnits(units, template.prioritization);

    const sections: { name: string; content: string }[] = [];
    let totalTokens = 0;
    let totalUnits = 0;
    const tokenBudget = template.maxTokens ?? Infinity;

    for (const section of template.sections) {
      // Filter units for this section
      const sectionUnits = sorted.filter((su) => {
        if (section.contentTypes && !section.contentTypes.includes(su.unit.metadata.contentType)) {
          return false;
        }
        if (section.tags && !section.tags.some((t) => su.unit.metadata.tags.includes(t))) {
          return false;
        }
        return true;
      });

      // Limit units per section
      const limited = section.maxUnits
        ? sectionUnits.slice(0, section.maxUnits)
        : sectionUnits;

      // Build section content
      const lines: string[] = [];
      for (const su of limited) {
        const lineTokens = estimateTokens(su.unit.content);
        if (totalTokens + lineTokens > tokenBudget) break;
        lines.push(`- ${su.unit.content}`);
        totalTokens += lineTokens;
        totalUnits++;

        // Record inclusion usage
        await this.deps.unitStore.recordUsage(su.unit.id, 'inclusion');
      }

      if (lines.length > 0) {
        let content = '';
        if (section.prefix) content += section.prefix;
        content += lines.join('\n');
        if (section.suffix) content += '\n' + section.suffix;
        sections.push({ name: section.name, content });
      }
    }

    // Add any remaining units that didn't match a section
    const assignedIds = new Set(
      sections.flatMap((s) =>
        sorted
          .filter((su) => s.content.includes(su.unit.content))
          .map((su) => su.unit.id),
      ),
    );
    const unassigned = sorted.filter((su) => !assignedIds.has(su.unit.id));
    if (unassigned.length > 0) {
      const lines: string[] = [];
      for (const su of unassigned) {
        const lineTokens = estimateTokens(su.unit.content);
        if (totalTokens + lineTokens > tokenBudget) break;
        lines.push(`- ${su.unit.content}`);
        totalTokens += lineTokens;
        totalUnits++;
      }
      if (lines.length > 0) {
        sections.push({
          name: 'additional',
          content: '## Additional Context\n' + lines.join('\n'),
        });
      }
    }

    return {
      sections,
      totalUnits,
      totalTokensEstimate: totalTokens,
      template,
    };
  }

  private sortUnits(
    units: ScoredUnit[],
    prioritization: AssemblyTemplate['prioritization'],
  ): ScoredUnit[] {
    const sorted = [...units];
    switch (prioritization) {
      case 'relevance':
        sorted.sort((a, b) => b.score - a.score);
        break;
      case 'recency':
        sorted.sort((a, b) => b.unit.metadata.updatedAt - a.unit.metadata.updatedAt);
        break;
      case 'usage':
        sorted.sort((a, b) => b.unit.usage.inclusionCount - a.unit.usage.inclusionCount);
        break;
      case 'custom':
        // Leave as-is (caller controls order)
        break;
    }
    return sorted;
  }
}

/**
 * Pipeline step handler for assembly.
 */
export function createAssembleStep(assembler: Assembler, template?: AssemblyTemplate) {
  return async (ctx: PipelineContext): Promise<PipelineContext> => {
    if (ctx.retrievedUnits.length === 0) return ctx;

    const tmpl = template ?? DEFAULT_TEMPLATE;
    ctx.assembledInput = await assembler.assemble(ctx.retrievedUnits, tmpl);
    const totalSections = tmpl.sections.length;
    const populatedSections = ctx.assembledInput.sections.length;
    const tokenBudget = tmpl.maxTokens ?? Infinity;
    const tokensUsed = ctx.assembledInput.totalTokensEstimate;
    ctx.stepResults['assemble'] = {
      sections: populatedSections,
      sectionsEmpty: totalSections - populatedSections,
      totalUnits: ctx.assembledInput.totalUnits,
      tokensEstimate: tokensUsed,
      tokenBudget: isFinite(tokenBudget) ? tokenBudget : 0,
      tokenUtilization: isFinite(tokenBudget) && tokenBudget > 0
        ? tokensUsed / tokenBudget
        : 0,
      unitsExcludedByBudget: ctx.retrievedUnits.length - ctx.assembledInput.totalUnits,
      unitIds: ctx.retrievedUnits
        .slice(0, ctx.assembledInput.totalUnits)
        .map((su) => su.unit.id),
    };
    return ctx;
  };
}
