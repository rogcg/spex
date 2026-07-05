import { type NextCommandSuggestions, NextCommandSuggestionsSchema } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/provider.js';
import { NEXT_COMMAND_SYSTEM_PROMPT } from './prompts.js';
import { suggestNextCommands } from './suggest.js';

const sample: NextCommandSuggestions = {
  suggestions: [
    { command: 'spex implement "<feature>"', reason: 'The tech spec is ready — build a feature.' },
    { command: 'spex github setup', reason: 'Connect GitHub so SPEX can open PRs.' },
  ],
};

describe('suggestNextCommands', () => {
  it('forwards the system prompt and suggestions schema to the LLM', async () => {
    const generate = vi.fn().mockResolvedValue(sample);
    const llm: LLMProvider = { generateStructured: generate };

    const result = await suggestNextCommands({
      llm,
      context: { command: 'init', outcome: '.ai/ initialised' },
    });

    expect(result).toEqual(sample);
    const call = generate.mock.calls[0]?.[0];
    expect(call.systemPrompt).toBe(NEXT_COMMAND_SYSTEM_PROMPT);
    expect(call.schema).toBe(NextCommandSuggestionsSchema);
  });

  it('embeds the command, outcome, and facts in the user prompt', async () => {
    const generate = vi.fn().mockResolvedValue(sample);
    const llm: LLMProvider = { generateStructured: generate };

    await suggestNextCommands({
      llm,
      context: {
        command: 'implement',
        outcome: 'feature implemented on branch feat/pagination, PR opened',
        facts: ['GitHub integration is configured'],
      },
    });

    const userPrompt: string = generate.mock.calls[0]?.[0].userPrompt;
    expect(userPrompt).toContain('spex implement');
    expect(userPrompt).toContain('branch feat/pagination');
    expect(userPrompt).toContain('- GitHub integration is configured');
  });
});
