import { type NextCommandSuggestions, NextCommandSuggestionsSchema } from '@spex/schemas';
import type { LLMProvider } from '../llm/provider.js';
import {
  NEXT_COMMAND_SYSTEM_PROMPT,
  type SuggestionContext,
  buildNextCommandUserPrompt,
} from './prompts.js';

export interface SuggestNextCommandsOptions {
  llm: LLMProvider;
  context: SuggestionContext;
}

/**
 * Asks the LLM which SPEX commands the user should consider running next, given
 * the command that just finished and the current project state. The model is
 * primed with the SPEX command catalog so its suggestions follow the real flow.
 */
export async function suggestNextCommands(
  opts: SuggestNextCommandsOptions,
): Promise<NextCommandSuggestions> {
  return opts.llm.generateStructured({
    systemPrompt: NEXT_COMMAND_SYSTEM_PROMPT,
    userPrompt: buildNextCommandUserPrompt(opts.context),
    schema: NextCommandSuggestionsSchema,
  });
}
