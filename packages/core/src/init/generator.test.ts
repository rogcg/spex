import { type TechSpec, TechSpecSchema } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/provider.js';
import type { DetectedStack } from './detect-stack.js';
import { generateInitTechSpec } from './generator.js';
import { INIT_INFERRED_FIELDS, INIT_TECH_SPEC_SYSTEM_PROMPT } from './prompts.js';

const detectedStack: DetectedStack = {
  packageName: 'demo-app',
  framework: 'nextjs',
  frameworkVersion: '15',
  language: 'typescript',
  styling: 'tailwindcss',
  appRouter: true,
  srcDir: true,
  signals: {
    framework: '"next" dependency declared at ^15.0.0',
    frameworkVersion: 'parsed from "next" range "^15.0.0"',
    language: 'tsconfig.json present',
    styling: '"tailwindcss" dependency at ^3.4.0',
    appRouter: 'src/app/ directory present',
    srcDir: 'src/ directory present',
  },
};

const sampleSpec: TechSpec = {
  version: 1,
  project: {
    name: 'demo-app',
    type: 'web-app',
    description: 'A retroactive demo',
  },
  context: {
    primary_users: 'Internal team',
    expected_scale: 'Less than 100 users',
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
    commands: ['pnpm install  # project already scaffolded'],
  },
  rationale:
    'The project already uses Next.js App Router with Tailwind, which fits the described internal tool well.',
  inference: {
    inferred: true,
    inferred_fields: [...INIT_INFERRED_FIELDS],
    notes: 'Framework facts came from the existing project; context came from the user.',
  },
};

describe('generateInitTechSpec', () => {
  it('forwards the init system prompt and TechSpecSchema to the LLM', async () => {
    const generate = vi.fn().mockResolvedValue(sampleSpec);
    const llm: LLMProvider = { generateStructured: generate };

    const result = await generateInitTechSpec({
      llm,
      projectName: 'demo-app',
      stack: detectedStack,
      answers: { project_type: 'internal tool', description: 'An internal demo' },
    });

    expect(result).toEqual(sampleSpec);
    const call = generate.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.systemPrompt).toBe(INIT_TECH_SPEC_SYSTEM_PROMPT);
    expect(call.schema).toBe(TechSpecSchema);
  });

  it('embeds the detected stack and the INIT_INFERRED_FIELDS list in the user prompt', async () => {
    const generate = vi.fn().mockResolvedValue(sampleSpec);
    const llm: LLMProvider = { generateStructured: generate };

    await generateInitTechSpec({
      llm,
      projectName: 'demo-app',
      stack: detectedStack,
      answers: { project_type: 'internal tool' },
    });

    const userPrompt: string = generate.mock.calls[0]?.[0].userPrompt;
    expect(userPrompt).toContain('Project name: demo-app');
    expect(userPrompt).toContain('framework: nextjs');
    expect(userPrompt).toContain('frameworkVersion: 15');
    expect(userPrompt).toContain('styling: tailwindcss');
    expect(userPrompt).toContain('appRouter: true');
    for (const field of INIT_INFERRED_FIELDS) {
      expect(userPrompt).toContain(field);
    }
    expect(userPrompt).toContain('- project_type: internal tool');
  });

  it('propagates errors from the LLM provider', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockRejectedValue(new Error('llm down')),
    };
    await expect(
      generateInitTechSpec({
        llm,
        projectName: 'demo-app',
        stack: detectedStack,
        answers: {},
      }),
    ).rejects.toThrow('llm down');
  });
});
