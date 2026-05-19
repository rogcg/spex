// Deliberately simple character-based heuristic to estimate tokens.
// Anthropic's tokenizer counts roughly 1 token per 4 characters for
// typical source code. A real tokenizer can be swapped in later.
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export const DEFAULT_BUDGET_TOKENS = 50_000;
