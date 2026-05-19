import type { LLMProvider } from '@spex/core';
import { describe, expect, it, vi } from 'vitest';
import { polishPrDescription } from './polish.js';
import type { PrDescription } from './template.js';

const template: PrDescription = {
  title: 'feat(x): do the thing',
  body: '## Summary\n\nDoes the thing.',
};

describe('polishPrDescription', () => {
  it('returns the LLM result when the call succeeds and validates', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockResolvedValue({
        title: 'feat(x): polish the thing',
        body: '## Summary\n\nPolished body.',
      }),
    };
    const result = await polishPrDescription({ llm, template });
    expect(result.title).toBe('feat(x): polish the thing');
    expect(result.body).toBe('## Summary\n\nPolished body.');
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  });

  it('falls back to the template when the LLM throws', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockRejectedValue(new Error('network down')),
    };
    const result = await polishPrDescription({ llm, template });
    expect(result).toEqual(template);
  });

  it('falls back to the template when the LLM returns an invalid shape', async () => {
    // The provider's generateStructured contract is that validation has already
    // happened by the time it resolves. Simulate a downstream throw to exercise
    // the fallback path.
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockRejectedValue(new Error('schema mismatch')),
    };
    const result = await polishPrDescription({ llm, template });
    expect(result).toEqual(template);
  });

  it('includes extra instructions in the user prompt when provided', async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      title: template.title,
      body: template.body,
    });
    const llm: LLMProvider = { generateStructured };
    await polishPrDescription({
      llm,
      template,
      extraInstructions: 'Use Conventional Commits.',
    });
    const call = generateStructured.mock.calls[0];
    if (!call) throw new Error('generateStructured was not called');
    const args = call[0] as { userPrompt: string };
    expect(args.userPrompt).toContain('Use Conventional Commits.');
  });
});
