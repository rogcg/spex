import { type TechSpec, TechSpecSchema } from '@spex/schemas';
import type { DiscoveryAnswers } from '../discovery/questions.js';
import type { LLMProvider } from '../llm/provider.js';
import type { DetectedStack } from './detect-stack.js';
import {
  INIT_INFERRED_FIELDS,
  INIT_TECH_SPEC_SYSTEM_PROMPT,
  buildInitTechSpecUserPrompt,
} from './prompts.js';

export interface GenerateInitTechSpecOptions {
  llm: LLMProvider;
  projectName: string;
  stack: DetectedStack;
  answers: DiscoveryAnswers;
}

export async function generateInitTechSpec(opts: GenerateInitTechSpecOptions): Promise<TechSpec> {
  return opts.llm.generateStructured({
    systemPrompt: INIT_TECH_SPEC_SYSTEM_PROMPT,
    userPrompt: buildInitTechSpecUserPrompt({
      projectName: opts.projectName,
      stack: opts.stack,
      answers: opts.answers,
      inferredFields: INIT_INFERRED_FIELDS,
    }),
    schema: TechSpecSchema,
  });
}
