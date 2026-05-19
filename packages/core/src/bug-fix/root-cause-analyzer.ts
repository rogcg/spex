import {
  type BugContext,
  type Hypothesis,
  type RootCauseAnalysis,
  RootCauseAnalysisSchema,
} from '@spex/schemas';
import type { LLMProvider } from '../llm/provider.js';
import { ROOT_CAUSE_SYSTEM_PROMPT, buildRootCauseUserPrompt } from './prompts.js';

export interface AnalyzeRootCauseOptions {
  llm: LLMProvider;
  bugContext: BugContext;
  hypothesis: Hypothesis;
}

export async function analyzeRootCause(opts: AnalyzeRootCauseOptions): Promise<RootCauseAnalysis> {
  return opts.llm.generateStructured({
    systemPrompt: ROOT_CAUSE_SYSTEM_PROMPT,
    userPrompt: buildRootCauseUserPrompt({
      bugContext: opts.bugContext,
      hypothesis: opts.hypothesis,
    }),
    schema: RootCauseAnalysisSchema,
  });
}
