import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGET_TOKENS, estimateTokens } from './token-budget.js';

describe('estimateTokens', () => {
  it('returns 0 for empty strings', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('rounds up to ensure no tokens are silently dropped', () => {
    // 5 chars / 4 = 1.25 -> ceil = 2
    expect(estimateTokens('hello')).toBe(2);
  });

  it('treats 4 characters as a single token', () => {
    expect(estimateTokens('abcd')).toBe(1);
  });
});

describe('DEFAULT_BUDGET_TOKENS', () => {
  it('defaults to 50_000 tokens', () => {
    expect(DEFAULT_BUDGET_TOKENS).toBe(50_000);
  });
});
