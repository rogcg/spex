import type { NextCommandSuggestion } from '@spex/schemas';
import { STRINGS } from '../strings.js';

/**
 * Renders a "What's next?" table from the LLM-generated command suggestions so
 * the user always knows which command naturally comes next in the SPEX flow.
 * No-ops on an empty list. The table chrome comes from `STRINGS.nextSteps` to
 * keep user-facing copy centralised.
 */
export function printNextSteps(suggestions: readonly NextCommandSuggestion[]): void {
  if (suggestions.length === 0) return;

  const { header, commandColumn, descriptionColumn, hint } = STRINGS.nextSteps;

  const commandWidth = Math.max(commandColumn.length, ...suggestions.map((s) => s.command.length));

  console.log(`\n${header}`);
  console.log(`  ${commandColumn.padEnd(commandWidth)}  ${descriptionColumn}`);
  for (const suggestion of suggestions) {
    console.log(`  ${suggestion.command.padEnd(commandWidth)}  ${suggestion.reason}`);
  }
  console.log(`\n${hint}\n`);
}
