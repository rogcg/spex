import type { FeatureSpec, TechSpec } from '@spex/schemas';
import { describe, expect, it } from 'vitest';
import type { CodebaseContext } from '../context/types.js';
import { IMPLEMENTATION_PLAN_SYSTEM_PROMPT, buildPlanUserPrompt } from './prompts.js';

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
    { path: 'src/legacy/pager.tsx', operation: 'delete' },
  ],
  test_cases: ['renders page 1 by default'],
  rationale: 'Matches the existing App Router conventions and stays close to URL-driven state.',
};

const techSpec: TechSpec = {
  version: 1,
  project: { name: 'demo', type: 'web-app', description: 'A demo project' },
  context: {
    primary_users: 'Internal team',
    expected_scale: 'Less than 100 users',
    auth_requirements: 'None',
    data_persistence: 'Simple key-value',
  },
  stack: {
    label: 'Next.js + Tailwind',
    source: 'recommended',
    components: [
      { role: 'framework', choice: 'Next.js 15 App Router', rationale: 'Web app' },
      { role: 'styling', choice: 'Tailwind CSS', rationale: 'Styling' },
    ],
    tradeoffs: [],
    validation_warnings: [],
  },
  rationale: 'Next.js App Router with Tailwind for a small internal tool — straightforward DX.',
};

const context: CodebaseContext = {
  projectDir: '/tmp/demo',
  techSpec,
  packageInfo: {
    name: 'demo',
    version: '0.1.0',
    scripts: { dev: 'next dev' },
    dependencies: { next: '^15.0.0' },
    devDependencies: { typescript: '^5.0.0' },
    peerDependencies: {},
  },
  relevantFiles: [
    {
      path: 'src/app/users/page.tsx',
      content: 'export default function Users() { return null; }\n',
      bytes: 50,
      estimatedTokens: 13,
    },
    {
      path: 'src/legacy/pager.tsx',
      content: 'export function Pager() { return null; }\n',
      bytes: 42,
      estimatedTokens: 11,
    },
    {
      path: 'src/util.ts',
      content: 'export const x = 1;\n',
      bytes: 20,
      estimatedTokens: 5,
    },
  ],
  detectedPatterns: {
    fileNamingConvention: 'kebab-case',
    componentStructure: 'components-folder',
    testingPattern: 'colocated',
  },
  budget: { limitTokens: 50_000, usedTokens: 29, truncated: false, excludedFiles: 0 },
};

describe('IMPLEMENTATION_PLAN_SYSTEM_PROMPT', () => {
  it('documents the order, atomicity, and reversibility constraints', () => {
    expect(IMPLEMENTATION_PLAN_SYSTEM_PROMPT).toContain('order starting at 1');
    expect(IMPLEMENTATION_PLAN_SYSTEM_PROMPT).toContain('Atomic');
    expect(IMPLEMENTATION_PLAN_SYSTEM_PROMPT).toContain('Reversible');
  });

  it('documents the per-operation content requirements', () => {
    expect(IMPLEMENTATION_PLAN_SYSTEM_PROMPT).toContain("REQUIRED for 'create'");
    expect(IMPLEMENTATION_PLAN_SYSTEM_PROMPT).toContain("Only valid for 'modify' operations");
    expect(IMPLEMENTATION_PLAN_SYSTEM_PROMPT).toContain(
      "'delete' operations MUST NOT carry full_content or diff",
    );
  });
});

describe('buildPlanUserPrompt', () => {
  it('embeds the feature spec as YAML', () => {
    const prompt = buildPlanUserPrompt({ featureSpec, context });
    expect(prompt).toContain('slug: add-pagination');
    expect(prompt).toContain('Approved feature spec');
  });

  it('embeds full content of modify-target files from the context', () => {
    const prompt = buildPlanUserPrompt({ featureSpec, context });
    expect(prompt).toContain('=== src/app/users/page.tsx (modify) ===');
    expect(prompt).toContain('export default function Users()');
  });

  it('embeds full content of delete-target files from the context', () => {
    const prompt = buildPlanUserPrompt({ featureSpec, context });
    expect(prompt).toContain('=== src/legacy/pager.tsx (delete) ===');
    expect(prompt).toContain('export function Pager()');
  });

  it('does NOT embed the full content of create-target files (they do not exist yet)', () => {
    const prompt = buildPlanUserPrompt({ featureSpec, context });
    expect(prompt).not.toContain('=== src/components/pagination.tsx (create) ===');
  });

  it('flags target files that are missing from the context', () => {
    const specWithMissing: FeatureSpec = {
      ...featureSpec,
      files_affected: [{ path: 'src/missing.tsx', operation: 'modify' }],
    };
    const prompt = buildPlanUserPrompt({ featureSpec: specWithMissing, context });
    expect(prompt).toContain('=== src/missing.tsx (modify) ===');
    expect(prompt).toContain('file not found in the provided context');
  });

  it('lists remaining files (paths only) excluding files_affected paths', () => {
    const prompt = buildPlanUserPrompt({ featureSpec, context });
    expect(prompt).toContain('- src/util.ts');
    // Affected paths should NOT appear in the "other files" listing
    const otherFilesSection = prompt.slice(prompt.indexOf('### Other files in the project'));
    expect(otherFilesSection).not.toContain('- src/app/users/page.tsx');
    expect(otherFilesSection).not.toContain('- src/legacy/pager.tsx');
  });

  it('embeds codebase summary including detected patterns and deps', () => {
    const prompt = buildPlanUserPrompt({ featureSpec, context });
    expect(prompt).toContain('file naming convention: kebab-case');
    expect(prompt).toContain('component structure: components-folder');
    expect(prompt).toContain('testing pattern: colocated');
    expect(prompt).toContain('dependencies (1): next');
  });

  it('notes when the file listing was truncated by budget', () => {
    const truncatedContext: CodebaseContext = {
      ...context,
      budget: { limitTokens: 10, usedTokens: 5, truncated: true, excludedFiles: 3 },
    };
    const prompt = buildPlanUserPrompt({ featureSpec, context: truncatedContext });
    expect(prompt).toContain('truncated');
    expect(prompt).toContain('3 file(s)');
  });
});
