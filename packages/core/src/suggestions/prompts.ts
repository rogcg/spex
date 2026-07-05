import { SPEX_CATALOG } from './catalog.js';

/** Structured facts about the command that just finished, fed to the model. */
export interface SuggestionContext {
  /** The command that just completed, e.g. "init", "implement", "fix", "review", "new". */
  command: string;
  /** One-line summary of the outcome, e.g. "feature implemented on branch feat/x, PR opened". */
  outcome: string;
  /** Optional extra state facts the model should weigh (branch names, missing config, …). */
  facts?: readonly string[];
}

export const NEXT_COMMAND_SYSTEM_PROMPT = `You are SPEX's guide. After a SPEX command finishes, you propose the commands the user should consider running next, based on the SPEX workflow and what just happened.

${SPEX_CATALOG}

Return only structured suggestions — no prose outside the schema.`;

export function buildNextCommandUserPrompt(context: SuggestionContext): string {
  const facts =
    context.facts && context.facts.length > 0
      ? `\n\nRelevant state:\n${context.facts.map((f) => `- ${f}`).join('\n')}`
      : '';

  return `The user just finished running: spex ${context.command}

Outcome: ${context.outcome}${facts}

Suggest the commands the user should consider running next.`;
}
