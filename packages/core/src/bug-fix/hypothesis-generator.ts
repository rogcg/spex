import { type BugContext, type HypothesisList, HypothesisListSchema } from '@spex/schemas';
import type { LLMProvider } from '../llm/provider.js';
import { HYPOTHESIS_SYSTEM_PROMPT, buildHypothesisUserPrompt } from './prompts.js';

export interface GenerateHypothesesOptions {
  llm: LLMProvider;
  bugContext: BugContext;
}

export async function generateHypotheses(opts: GenerateHypothesesOptions): Promise<HypothesisList> {
  return opts.llm.generateStructured({
    systemPrompt: HYPOTHESIS_SYSTEM_PROMPT,
    userPrompt: buildHypothesisUserPrompt({ bugContext: opts.bugContext }),
    schema: HypothesisListSchema,
  });
}
