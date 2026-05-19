import type { z } from 'zod';

export interface LLMProvider {
  generateStructured<T>(opts: {
    systemPrompt: string;
    userPrompt: string;
    schema: z.ZodSchema<T>;
  }): Promise<T>;
}
