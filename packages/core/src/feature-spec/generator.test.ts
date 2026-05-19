import { type FeatureSpec, FeatureSpecSchema } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { CodebaseContext } from '../context/types.js';
import type { LLMProvider } from '../llm/provider.js';
import { generateFeatureSpec } from './generator.js';
import { FEATURE_SPEC_SYSTEM_PROMPT } from './prompts.js';

const sample: FeatureSpec = {
  version: 1,
  feature: {
    slug: 'add-pagination',
    title: 'Add pagination',
    description: 'Paginates the user list page.',
  },
  scope: { in: ['page query param'], out: [] },
  technical_approach:
    'Add a page query param to the users route and slice the dataset accordingly.',
  files_affected: [{ path: 'src/app/users/page.tsx', operation: 'modify' }],
  test_cases: ['renders page 1 by default'],
  rationale: 'Matches the existing App Router conventions and stays close to URL-driven state.',
};

const context: CodebaseContext = {
  projectDir: '/tmp/demo',
  techSpec: null,
  packageInfo: {
    name: 'demo',
    version: null,
    scripts: {},
    dependencies: { next: '^15.0.0' },
    devDependencies: {},
    peerDependencies: {},
  },
  relevantFiles: [{ path: 'src/app/users/page.tsx', content: 'x', bytes: 1, estimatedTokens: 1 }],
  detectedPatterns: {
    fileNamingConvention: 'kebab-case',
    componentStructure: 'colocated',
    testingPattern: 'none',
  },
  budget: { limitTokens: 50_000, usedTokens: 1, truncated: false, excludedFiles: 0 },
};

describe('generateFeatureSpec', () => {
  it('forwards the system prompt and FeatureSpecSchema to the LLM', async () => {
    const generate = vi.fn().mockResolvedValue(sample);
    const llm: LLMProvider = { generateStructured: generate };

    const result = await generateFeatureSpec({
      llm,
      description: 'add pagination',
      context,
    });

    expect(result).toEqual(sample);
    const call = generate.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.systemPrompt).toBe(FEATURE_SPEC_SYSTEM_PROMPT);
    expect(call.schema).toBe(FeatureSpecSchema);
  });

  it('embeds the description and codebase summary in the user prompt', async () => {
    const generate = vi.fn().mockResolvedValue(sample);
    const llm: LLMProvider = { generateStructured: generate };

    await generateFeatureSpec({
      llm,
      description: 'add pagination to user list',
      context,
    });

    const prompt: string = generate.mock.calls[0]?.[0].userPrompt;
    expect(prompt).toContain('add pagination to user list');
    expect(prompt).toContain('src/app/users/page.tsx');
    expect(prompt).toContain('file naming convention: kebab-case');
  });

  it('propagates errors from the LLM provider', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockRejectedValue(new Error('llm down')),
    };
    await expect(generateFeatureSpec({ llm, description: 'x', context })).rejects.toThrow(
      'llm down',
    );
  });
});
