import { type FeatureSpec, FeatureSpecSchema } from '@spex/schemas';
import type { CodebaseContext } from '../context/types.js';
import type { LLMProvider } from '../llm/provider.js';
import { FEATURE_SPEC_SYSTEM_PROMPT, buildFeatureSpecUserPrompt } from './prompts.js';

export interface GenerateFeatureSpecOptions {
  llm: LLMProvider;
  description: string;
  context: CodebaseContext;
}

export async function generateFeatureSpec(opts: GenerateFeatureSpecOptions): Promise<FeatureSpec> {
  return opts.llm.generateStructured({
    systemPrompt: FEATURE_SPEC_SYSTEM_PROMPT,
    userPrompt: buildFeatureSpecUserPrompt({
      description: opts.description,
      context: opts.context,
    }),
    schema: FeatureSpecSchema,
  });
}
