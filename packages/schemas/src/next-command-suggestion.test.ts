import { describe, expect, it } from 'vitest';
import {
  NextCommandSuggestionSchema,
  NextCommandSuggestionsSchema,
} from './next-command-suggestion.js';

describe('NextCommandSuggestionSchema', () => {
  it('parses a command with a reason', () => {
    const parsed = NextCommandSuggestionSchema.parse({
      command: 'spex implement "add pagination"',
      reason: 'The tech spec is ready — build your first feature.',
    });
    expect(parsed.command).toBe('spex implement "add pagination"');
  });

  it('rejects an empty command', () => {
    expect(() =>
      NextCommandSuggestionSchema.parse({ command: '', reason: 'do something useful' }),
    ).toThrow();
  });

  it('rejects a reason that is too short', () => {
    expect(() =>
      NextCommandSuggestionSchema.parse({ command: 'spex logs', reason: 'no' }),
    ).toThrow();
  });
});

describe('NextCommandSuggestionsSchema', () => {
  it('accepts one to four suggestions', () => {
    const parsed = NextCommandSuggestionsSchema.parse({
      suggestions: [{ command: 'spex review 42', reason: 'Review the PR that was opened.' }],
    });
    expect(parsed.suggestions).toHaveLength(1);
  });

  it('rejects an empty list', () => {
    expect(() => NextCommandSuggestionsSchema.parse({ suggestions: [] })).toThrow();
  });

  it('rejects more than four suggestions', () => {
    const one = { command: 'spex logs', reason: 'Inspect the audit trail.' };
    expect(() =>
      NextCommandSuggestionsSchema.parse({ suggestions: [one, one, one, one, one] }),
    ).toThrow();
  });
});
