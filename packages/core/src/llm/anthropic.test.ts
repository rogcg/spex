import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MissingApiKeyError } from '../errors.js';

const { mockGenerateObject, mockAnthropic } = vi.hoisted(() => ({
  mockGenerateObject: vi.fn(),
  mockAnthropic: vi.fn((modelId: string) => ({ modelId })),
}));

vi.mock('ai', () => ({
  generateObject: mockGenerateObject,
}));

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: mockAnthropic,
}));

const { AnthropicProvider } = await import('./anthropic.js');

describe('AnthropicProvider', () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    mockGenerateObject.mockReset();
    mockAnthropic.mockClear();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      // biome-ignore lint/performance/noDelete: must truly unset, since assigning undefined coerces to the string "undefined" in process.env
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  it('throws MissingApiKeyError when ANTHROPIC_API_KEY is not set', () => {
    // biome-ignore lint/performance/noDelete: see afterEach
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicProvider()).toThrow(MissingApiKeyError);
  });

  it('throws MissingApiKeyError when ANTHROPIC_API_KEY is an empty string', () => {
    process.env.ANTHROPIC_API_KEY = '';
    expect(() => new AnthropicProvider()).toThrow(MissingApiKeyError);
  });

  it('forwards system and user prompts to generateObject and returns the parsed object', async () => {
    const schema = z.object({ greeting: z.string() });
    mockGenerateObject.mockResolvedValue({ object: { greeting: 'hi' } });

    const provider = new AnthropicProvider();
    const result = await provider.generateStructured({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      schema,
    });

    expect(result).toEqual({ greeting: 'hi' });
    expect(mockAnthropic).toHaveBeenCalledWith('claude-sonnet-4-6');
    expect(mockGenerateObject).toHaveBeenCalledWith({
      model: { modelId: 'claude-sonnet-4-6' },
      schema,
      system: 'sys',
      prompt: 'usr',
    });
  });

  it('uses an override model when provided', async () => {
    mockGenerateObject.mockResolvedValue({ object: { ok: true } });
    const provider = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await provider.generateStructured({
      systemPrompt: 's',
      userPrompt: 'u',
      schema: z.object({ ok: z.boolean() }),
    });

    expect(mockAnthropic).toHaveBeenCalledWith('claude-haiku-4-5');
  });

  it('propagates errors from the underlying SDK call', async () => {
    mockGenerateObject.mockRejectedValue(new Error('rate limited'));
    const provider = new AnthropicProvider();

    await expect(
      provider.generateStructured({
        systemPrompt: 's',
        userPrompt: 'u',
        schema: z.object({ x: z.number() }),
      }),
    ).rejects.toThrow('rate limited');
  });
});
