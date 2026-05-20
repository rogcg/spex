import type { StackDecision, TechSpec } from '@spex/schemas';
import { TechSpecSchema } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/provider.js';
import { generateTechSpec } from './generator.js';
import { TECH_SPEC_SYSTEM_PROMPT } from './prompts.js';

const sampleDecision: StackDecision = {
  label: 'Next.js + Postgres + Drizzle',
  source: 'recommended',
  components: [
    { role: 'framework', choice: 'Next.js 15 App Router', rationale: 'SSR web app' },
    { role: 'database', choice: 'Postgres', rationale: 'Relational persistence' },
    { role: 'orm', choice: 'Drizzle', rationale: 'Type-safe SQL' },
  ],
  rationale: 'Best fit for a TypeScript SaaS with relational data.',
  tradeoffs: ['Vendor coupling to Vercel for previews'],
  validationWarnings: [],
};

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
    label: sampleDecision.label,
    source: sampleDecision.source,
    components: sampleDecision.components,
    tradeoffs: sampleDecision.tradeoffs,
    validation_warnings: sampleDecision.validationWarnings,
  },
  rationale:
    'Next.js with App Router gives us streaming SSR and a strong DX for this developer-facing tool. Postgres + Drizzle keeps persistence type-safe.',
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
      decision: sampleDecision,
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
    expect(call.userPrompt).toContain('Next.js + Postgres + Drizzle');
    expect(call.userPrompt).toContain('source: recommended');
  });

  it('returns the value resolved by the LLM provider unchanged', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockResolvedValue(sampleSpec),
    };

    const result = await generateTechSpec({
      llm,
      projectName: 'demo',
      answers: { project_type: 'x' },
      decision: sampleDecision,
    });

    expect(result).toBe(sampleSpec);
  });

  it('propagates errors from the LLM provider', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockRejectedValue(new Error('boom')),
    };

    await expect(
      generateTechSpec({ llm, projectName: 'demo', answers: {}, decision: sampleDecision }),
    ).rejects.toThrow('boom');
  });
});
