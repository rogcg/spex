import { type StackRecommendations, StackRecommendationsSchema } from '@spex/schemas';
import type { DiscoveryAnswers } from '../discovery/questions.js';
import type { LLMProvider } from '../llm/provider.js';
import {
  STACK_RECOMMENDATION_SYSTEM_PROMPT,
  buildStackRecommendationUserPrompt,
} from './prompts.js';

export interface RecommendStackOptions {
  llm: LLMProvider;
  projectName: string;
  answers: DiscoveryAnswers;
  explicitConstraints?: string;
}

export async function recommendStack(opts: RecommendStackOptions): Promise<StackRecommendations> {
  const result = await opts.llm.generateStructured({
    systemPrompt: STACK_RECOMMENDATION_SYSTEM_PROMPT,
    userPrompt: buildStackRecommendationUserPrompt({
      projectName: opts.projectName,
      answers: opts.answers,
      ...(opts.explicitConstraints !== undefined
        ? { explicitConstraints: opts.explicitConstraints }
        : {}),
    }),
    schema: StackRecommendationsSchema,
  });

  return normalizeRanks(result);
}

function normalizeRanks(result: StackRecommendations): StackRecommendations {
  const sorted = [...result.recommendations].sort((a, b) => a.rank - b.rank);
  const ranked = sorted.map((rec, index) => ({ ...rec, rank: index + 1 }));
  return { ...result, recommendations: ranked };
}
