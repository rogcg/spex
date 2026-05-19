import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import type { z } from 'zod';
import { MissingApiKeyError } from '../errors.js';
import type { LLMProvider } from './provider.js';

// Thinking-capable Opus models force tool_choice incompatibilities with AI SDK's
// generateObject (thinking and forced tool-use cannot both be enabled). Sonnet 4.6
// is non-thinking and produces reliable structured output. Override via the
// constructor's `model` option to swap models per-call.
const DEFAULT_MODEL = 'claude-sonnet-4-6';

export interface AnthropicProviderOptions {
  model?: string;
}

export class AnthropicProvider implements LLMProvider {
  readonly #model: string;

  constructor(options: AnthropicProviderOptions = {}) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new MissingApiKeyError('ANTHROPIC_API_KEY');
    }
    this.#model = options.model ?? DEFAULT_MODEL;
  }

  async generateStructured<T>(opts: {
    systemPrompt: string;
    userPrompt: string;
    schema: z.ZodSchema<T>;
  }): Promise<T> {
    const { object } = await generateObject({
      model: anthropic(this.#model),
      schema: opts.schema,
      system: opts.systemPrompt,
      prompt: opts.userPrompt,
    });
    return object;
  }
}
