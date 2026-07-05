import { z } from 'zod';

export const NextCommandSuggestionSchema = z.object({
  /** The exact command line the user should consider running next. */
  command: z.string().min(1, 'command must not be empty'),
  /** Why this command is the natural next step given the current flow. */
  reason: z.string().min(5, 'reason must be at least 5 characters'),
});
export type NextCommandSuggestion = z.infer<typeof NextCommandSuggestionSchema>;

export const NextCommandSuggestionsSchema = z.object({
  suggestions: z
    .array(NextCommandSuggestionSchema)
    .min(1, 'at least one suggestion is required')
    .max(4, 'at most four suggestions may be returned'),
});
export type NextCommandSuggestions = z.infer<typeof NextCommandSuggestionsSchema>;
