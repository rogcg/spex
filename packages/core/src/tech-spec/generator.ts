import { type StackDecision, type TechSpec, TechSpecSchema } from '@spex/schemas';
import type { DiscoveryAnswers } from '../discovery/questions.js';
import type { LLMProvider } from '../llm/provider.js';
import { TECH_SPEC_SYSTEM_PROMPT, buildTechSpecUserPrompt } from './prompts.js';

export interface GenerateTechSpecOptions {
  llm: LLMProvider;
  projectName: string;
  answers: DiscoveryAnswers;
  decision: StackDecision;
}

export async function generateTechSpec(opts: GenerateTechSpecOptions): Promise<TechSpec> {
  return opts.llm.generateStructured({
    systemPrompt: TECH_SPEC_SYSTEM_PROMPT,
    userPrompt: buildTechSpecUserPrompt({
      projectName: opts.projectName,
      answers: opts.answers,
      decision: opts.decision,
    }),
    schema: TechSpecSchema,
  });
}
