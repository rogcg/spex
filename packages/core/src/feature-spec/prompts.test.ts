import type { TechSpec } from '@spex/schemas';
import { describe, expect, it } from 'vitest';
import type { CodebaseContext } from '../context/types.js';
import { FEATURE_SPEC_SYSTEM_PROMPT, buildFeatureSpecUserPrompt } from './prompts.js';

const techSpec: TechSpec = {
  version: 1,
  project: { name: 'demo-app', type: 'web-app', description: 'A demo project' },
  context: {
    primary_users: 'Internal team',
    expected_scale: 'Less than 100 users',
    auth_requirements: 'None',
    data_persistence: 'Simple key-value',
  },
  stack: {
    label: 'Next.js 15 App Router + Tailwind',
    source: 'recommended',
    components: [
      { role: 'framework', choice: 'Next.js 15 App Router', rationale: 'Web app' },
      { role: 'styling', choice: 'Tailwind CSS', rationale: 'Rapid styling' },
    ],
    tradeoffs: [],
    validation_warnings: [],
  },
  rationale: 'Next.js App Router with Tailwind for a small internal tool — straightforward DX.',
};

function makeContext(overrides: Partial<CodebaseContext> = {}): CodebaseContext {
  const base: CodebaseContext = {
    projectDir: '/tmp/demo',
    techSpec,
    packageInfo: {
      name: 'demo-app',
      version: '0.1.0',
      scripts: { dev: 'next dev' },
      dependencies: { next: '^15.0.0', react: '^19.0.0' },
      devDependencies: { typescript: '^5.0.0' },
      peerDependencies: {},
    },
    relevantFiles: [
      { path: 'package.json', content: '{}', bytes: 2, estimatedTokens: 1 },
      { path: 'src/app/page.tsx', content: 'x', bytes: 1, estimatedTokens: 1 },
      { path: 'src/components/button.tsx', content: 'y', bytes: 1, estimatedTokens: 1 },
    ],
    detectedPatterns: {
      fileNamingConvention: 'kebab-case',
      componentStructure: 'components-folder',
      testingPattern: 'colocated',
    },
    budget: { limitTokens: 50_000, usedTokens: 3, truncated: false, excludedFiles: 0 },
  };
  return { ...base, ...overrides };
}

describe('FEATURE_SPEC_SYSTEM_PROMPT', () => {
  it('contains the kebab-case slug rule and operation enumeration', () => {
    expect(FEATURE_SPEC_SYSTEM_PROMPT).toContain('kebab-case');
    expect(FEATURE_SPEC_SYSTEM_PROMPT).toContain("'create'");
    expect(FEATURE_SPEC_SYSTEM_PROMPT).toContain("'modify'");
    expect(FEATURE_SPEC_SYSTEM_PROMPT).toContain("'delete'");
  });
});

describe('buildFeatureSpecUserPrompt', () => {
  it('embeds the feature description verbatim', () => {
    const prompt = buildFeatureSpecUserPrompt({
      description: 'add pagination to user list',
      context: makeContext(),
    });
    expect(prompt).toContain('add pagination to user list');
  });

  it('embeds tech-spec stack details', () => {
    const prompt = buildFeatureSpecUserPrompt({
      description: 'x',
      context: makeContext(),
    });
    expect(prompt).toContain('stack: Next.js 15 App Router + Tailwind');
    expect(prompt).toContain('source: recommended');
    expect(prompt).toContain('framework: Next.js 15 App Router');
    expect(prompt).toContain('styling: Tailwind CSS');
  });

  it('embeds package info: deps, devDeps, scripts', () => {
    const prompt = buildFeatureSpecUserPrompt({
      description: 'x',
      context: makeContext(),
    });
    expect(prompt).toContain('next, react');
    expect(prompt).toContain('typescript');
    expect(prompt).toContain('scripts (1): dev');
  });

  it('embeds detected patterns', () => {
    const prompt = buildFeatureSpecUserPrompt({
      description: 'x',
      context: makeContext(),
    });
    expect(prompt).toContain('file naming convention: kebab-case');
    expect(prompt).toContain('component structure: components-folder');
    expect(prompt).toContain('testing pattern: colocated');
  });

  it('embeds the file listing as a bullet list', () => {
    const prompt = buildFeatureSpecUserPrompt({
      description: 'x',
      context: makeContext(),
    });
    expect(prompt).toContain('- package.json');
    expect(prompt).toContain('- src/app/page.tsx');
    expect(prompt).toContain('- src/components/button.tsx');
  });

  it('notes when the file listing was truncated by budget', () => {
    const prompt = buildFeatureSpecUserPrompt({
      description: 'x',
      context: makeContext({
        budget: { limitTokens: 10, usedTokens: 5, truncated: true, excludedFiles: 7 },
      }),
    });
    expect(prompt).toContain('truncated');
    expect(prompt).toContain('7 file(s)');
  });

  it('signals when no tech-spec is present', () => {
    const prompt = buildFeatureSpecUserPrompt({
      description: 'x',
      context: makeContext({ techSpec: null }),
    });
    expect(prompt).toContain('no .ai/tech-spec.yaml present');
  });
});
