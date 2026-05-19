import { type TechSpec, TechSpecSchema } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/provider.js';
import { generateTechSpec } from './generator.js';
import { TECH_SPEC_SYSTEM_PROMPT } from './prompts.js';

const sampleSpec: TechSpec = {
  version: 1,
  project: {
    name: 'demo',
    type: 'developer-tool',
    description: 'A demo app',
  },
  context: {
    primary_users: 'Developers',
    expected_scale: '100-1000 users',
    auth_requirements: 'None',
    data_persistence: 'Simple key-value',
  },
  stack: {
    language: 'typescript',
    frontend: {
      framework: 'nextjs',
      version: '15',
      styling: 'tailwindcss',
      app_router: true,
    },
  },
  scaffolding_plan: {
    commands: [
      'pnpm create next-app@latest demo --typescript --tailwind --app --src-dir --import-alias "@/*" --use-pnpm',
    ],
  },
  rationale:
    'Next.js with App Router gives us streaming SSR and a strong DX for this developer-facing tool.',
};

describe('generateTechSpec', () => {
  it('forwards the system prompt, schema, and a constructed user prompt to the LLM', async () => {
    const generate = vi.fn().mockResolvedValue(sampleSpec);
    const llm: LLMProvider = { generateStructured: generate };

    const result = await generateTechSpec({
      llm,
      projectName: 'demo',
      answers: {
        project_type: 'developer tool',
        primary_users: 'Developers',
      },
    });

    expect(result).toEqual(sampleSpec);
    expect(generate).toHaveBeenCalledTimes(1);

    const call = generate.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.systemPrompt).toBe(TECH_SPEC_SYSTEM_PROMPT);
    expect(call.schema).toBe(TechSpecSchema);
    expect(call.userPrompt).toContain('Project name: demo');
    expect(call.userPrompt).toContain('- project_type: developer tool');
    expect(call.userPrompt).toContain('- primary_users: Developers');
  });

  it('returns the value resolved by the LLM provider unchanged', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockResolvedValue(sampleSpec),
    };

    const result = await generateTechSpec({
      llm,
      projectName: 'demo',
      answers: { project_type: 'x' },
    });

    expect(result).toBe(sampleSpec);
  });

  it('propagates errors from the LLM provider', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockRejectedValue(new Error('boom')),
    };

    await expect(generateTechSpec({ llm, projectName: 'demo', answers: {} })).rejects.toThrow(
      'boom',
    );
  });
});
