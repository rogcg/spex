import { type LLMProvider, type SuggestionContext, suggestNextCommands } from '@spex/core';
import { STRINGS } from '../strings.js';
import { printNextSteps } from '../ui/next-steps.js';

export interface SuggestNextStepsOptions {
  llm: LLMProvider;
  context: SuggestionContext;
}

/**
 * Asks the LLM which SPEX command to run next and renders the suggestions as a
 * table. This runs at the very end of a successful command, so a failure here
 * (network blip, model error) must never fail the command that just succeeded —
 * we degrade to a short pointer at `spex --help` instead.
 */
export async function suggestNextSteps(opts: SuggestNextStepsOptions): Promise<void> {
  console.log(STRINGS.nextSteps.thinking);
  try {
    const { suggestions } = await suggestNextCommands({ llm: opts.llm, context: opts.context });
    printNextSteps(suggestions);
  } catch {
    console.log(STRINGS.nextSteps.unavailable);
  }
}
