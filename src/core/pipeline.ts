/**
 * Pipeline orchestrator: configurable step chain with profiles.
 *
 * The pipeline is NOT a fixed chain — steps can be collapsed, reordered,
 * or the entire cycle can run as a single agent step. Profiles define
 * which steps run and in what order for different project/task types.
 */

import type {
  StepConfig,
  PipelineConfig,
  PipelineProfile,
  PipelineContext,
  PipelineInput,
  PipelineOutput,
} from './types.js';

export class Pipeline {
  private steps = new Map<string, StepConfig>();
  private profiles = new Map<string, PipelineProfile>();
  private defaultProfile: string;

  constructor(config?: Partial<PipelineConfig>) {
    this.defaultProfile = config?.defaultProfile ?? 'full';

    if (config?.steps) {
      for (const step of config.steps) {
        this.steps.set(step.id, step);
      }
    }

    if (config?.profiles) {
      for (const profile of config.profiles) {
        this.profiles.set(profile.name, profile);
      }
    }
  }

  /**
   * Run the pipeline with a specific profile (or default).
   */
  async run(input: PipelineInput, profileName?: string): Promise<PipelineOutput> {
    const name = profileName ?? input.profile ?? this.defaultProfile;
    const profile = this.profiles.get(name);

    // If no profile defined, run all enabled steps in insertion order
    const stepIds = profile
      ? profile.steps
      : [...this.steps.keys()];

    // Initialize pipeline context
    const ctx: PipelineContext = {
      input,
      stepResults: {},
      acquiredUnits: [],
      retrievedUnits: [],
      meta: {},
    };

    // Execute steps in order
    for (const stepId of stepIds) {
      const step = this.steps.get(stepId);
      if (!step || !step.enabled) continue;

      try {
        await step.handler(ctx);
      } catch (error) {
        ctx.stepResults[stepId] = {
          error: error instanceof Error ? error.message : String(error),
        };
        ctx.meta['lastError'] = { stepId, error: String(error) };
        // Continue — don't fail the whole pipeline on one step
      }
    }

    return {
      agentOutput: ctx.agentOutput,
      acquiredUnits: ctx.acquiredUnits,
      retrievedUnits: ctx.retrievedUnits,
      meta: {
        ...ctx.meta,
        stepResults: ctx.stepResults,
        profile: name,
      },
    };
  }

  /**
   * Run a single step by ID with the given context.
   */
  async runStep(stepId: string, ctx: PipelineContext): Promise<PipelineContext> {
    const step = this.steps.get(stepId);
    if (!step) throw new Error(`Step '${stepId}' not found`);
    return step.handler(ctx);
  }

  // -- Configuration --

  addStep(config: StepConfig): void {
    this.steps.set(config.id, config);
  }

  removeStep(stepId: string): void {
    this.steps.delete(stepId);
  }

  replaceStep(stepId: string, config: StepConfig): void {
    this.steps.set(stepId, config);
  }

  getStep(stepId: string): StepConfig | undefined {
    return this.steps.get(stepId);
  }

  setParams(stepId: string, params: Record<string, unknown>): void {
    const step = this.steps.get(stepId);
    if (step) {
      step.params = { ...step.params, ...params };
    }
  }

  // -- Profiles --

  addProfile(profile: PipelineProfile): void {
    this.profiles.set(profile.name, profile);
  }

  removeProfile(name: string): void {
    this.profiles.delete(name);
  }

  getProfile(name: string): PipelineProfile | undefined {
    return this.profiles.get(name);
  }

  setDefaultProfile(name: string): void {
    this.defaultProfile = name;
  }

  listProfiles(): PipelineProfile[] {
    return [...this.profiles.values()];
  }

  listSteps(): StepConfig[] {
    return [...this.steps.values()];
  }
}
