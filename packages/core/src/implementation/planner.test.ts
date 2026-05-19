import type { FeatureSpec, ImplementationPlan } from '@spex/schemas';
import { ImplementationPlanSchema } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { CodebaseContext } from '../context/types.js';
import type { LLMProvider } from '../llm/provider.js';
import { generateImplementationPlan } from './planner.js';
import { IMPLEMENTATION_PLAN_SYSTEM_PROMPT } from './prompts.js';

const featureSpec: FeatureSpec = {
  version: 1,
  feature: {
    slug: 'add-pagination',
    title: 'Add pagination',
    description: 'Paginates the user list page.',
  },
  scope: { in: ['page query param'], out: [] },
  technical_approach:
    'Add a `page` query param to the users route and slice the dataset accordingly.',
  files_affected: [
    { path: 'src/app/users/page.tsx', operation: 'modify' },
    { path: 'src/components/pagination.tsx', operation: 'create' },
  ],
  test_cases: ['renders page 1 by default'],
  rationale: 'Stays consistent with App Router conventions and URL-driven navigation.',
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
  relevantFiles: [
    {
      path: 'src/app/users/page.tsx',
      content: 'export default function Users() { return null; }\n',
      bytes: 50,
      estimatedTokens: 13,
    },
  ],
  detectedPatterns: {
    fileNamingConvention: 'kebab-case',
    componentStructure: 'components-folder',
    testingPattern: 'colocated',
  },
  budget: { limitTokens: 50_000, usedTokens: 13, truncated: false, excludedFiles: 0 },
};

const validPlan: ImplementationPlan = {
  feature_slug: 'add-pagination',
  operations: [
    {
      order: 1,
      path: 'src/components/pagination.tsx',
      operation: 'create',
      rationale: 'New Pagination component referenced by the modified users page.',
      full_content: 'export const Pagination = () => null;\n',
    },
    {
      order: 2,
      path: 'src/app/users/page.tsx',
      operation: 'modify',
      rationale: 'Read the `page` query param and render the new Pagination component.',
      diff: '@@ -1 +1,3 @@\n+import { Pagination } from "@/components/pagination";\n',
    },
  ],
  tests_to_add: [
    {
      path: 'src/components/pagination.test.tsx',
      content: 'test("renders", () => {});\n',
    },
  ],
};

describe('generateImplementationPlan', () => {
  it('forwards the system prompt and ImplementationPlanSchema to the LLM', async () => {
    const generate = vi.fn().mockResolvedValue(validPlan);
    const llm: LLMProvider = { generateStructured: generate };

    const result = await generateImplementationPlan({ llm, featureSpec, context });

    expect(result).toEqual(validPlan);
    const call = generate.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.systemPrompt).toBe(IMPLEMENTATION_PLAN_SYSTEM_PROMPT);
    expect(call.schema).toBe(ImplementationPlanSchema);
  });

  it('embeds the feature spec and target file content in the user prompt', async () => {
    const generate = vi.fn().mockResolvedValue(validPlan);
    const llm: LLMProvider = { generateStructured: generate };

    await generateImplementationPlan({ llm, featureSpec, context });

    const prompt: string = generate.mock.calls[0]?.[0].userPrompt;
    expect(prompt).toContain('slug: add-pagination');
    expect(prompt).toContain('=== src/app/users/page.tsx (modify) ===');
    expect(prompt).toContain('export default function Users()');
  });

  it('propagates errors from the LLM provider', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockRejectedValue(new Error('llm down')),
    };
    await expect(generateImplementationPlan({ llm, featureSpec, context })).rejects.toThrow(
      'llm down',
    );
  });
});
