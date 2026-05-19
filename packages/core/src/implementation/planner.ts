import { type FeatureSpec, type ImplementationPlan, ImplementationPlanSchema } from '@spex/schemas';
import type { CodebaseContext } from '../context/types.js';
import type { LLMProvider } from '../llm/provider.js';
import { IMPLEMENTATION_PLAN_SYSTEM_PROMPT, buildPlanUserPrompt } from './prompts.js';

export interface GenerateImplementationPlanOptions {
  llm: LLMProvider;
  featureSpec: FeatureSpec;
  context: CodebaseContext;
}

export async function generateImplementationPlan(
  opts: GenerateImplementationPlanOptions,
): Promise<ImplementationPlan> {
  return opts.llm.generateStructured({
    systemPrompt: IMPLEMENTATION_PLAN_SYSTEM_PROMPT,
    userPrompt: buildPlanUserPrompt({
      featureSpec: opts.featureSpec,
      context: opts.context,
    }),
    schema: ImplementationPlanSchema,
  });
}
