import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { buildCodebaseContext } from './aggregator.js';
import { DEFAULT_BUDGET_TOKENS } from './token-budget.js';

let projectDir: string;

const validTechSpec = {
  version: 1,
  project: { name: 'demo', type: 'web-app', description: 'A demo project' },
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
  scaffolding_plan: { commands: ['pnpm install  # already scaffolded'] },
  rationale:
    'Next.js with App Router provides a strong DX and supports server components for this internal tool.',
};

async function w(rel: string, content: string): Promise<void> {
  const path = join(projectDir, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

async function scaffoldSampleProject(): Promise<void> {
  await w(
    'package.json',
    JSON.stringify({
      name: 'demo-app',
      version: '0.1.0',
      scripts: { dev: 'next dev' },
      dependencies: { next: '^15.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    }),
  );
  await w('.gitignore', 'secret.ts\n');
  await mkdir(join(projectDir, '.ai'), { recursive: true });
  await writeFile(join(projectDir, '.ai', 'tech-spec.yaml'), stringifyYaml(validTechSpec), 'utf8');
  await w('src/app/page.tsx', 'export default function Page() { return null; }\n');
  await w('src/app/layout.tsx', 'export default function L({ children }) { return children; }\n');
  await w('src/components/button.tsx', 'export const Button = () => null;\n');
  await w('src/util.ts', 'export const x = 1;\n');
  await w('src/util.test.ts', 'import { x } from "./util";\n');
  await w('secret.ts', 'should be ignored');
  await w('node_modules/foo/index.ts', 'noise');
}

describe('buildCodebaseContext', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-context-agg-'));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('aggregates tech-spec, package info, files, and detected patterns', async () => {
    await scaffoldSampleProject();
    const ctx = await buildCodebaseContext({ projectDir });

    expect(ctx.techSpec?.project.name).toBe('demo');
    expect(ctx.packageInfo.name).toBe('demo-app');
    expect(ctx.packageInfo.dependencies).toEqual({ next: '^15.0.0' });

    const paths = ctx.relevantFiles.map((f) => f.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('src/app/page.tsx');
    expect(paths).toContain('src/components/button.tsx');
    expect(paths).not.toContain('secret.ts');
    expect(paths).not.toContain('node_modules/foo/index.ts');

    expect(ctx.detectedPatterns.componentStructure).toBe('components-folder');
    expect(ctx.detectedPatterns.testingPattern).toBe('colocated');
    expect(['kebab-case', 'mixed', 'camelCase', 'PascalCase']).toContain(
      ctx.detectedPatterns.fileNamingConvention,
    );
  });

  it('reports techSpec=null when .ai/tech-spec.yaml is absent', async () => {
    await w('package.json', JSON.stringify({ name: 'demo', dependencies: { next: '^15.0.0' } }));
    await w('src/index.ts', 'export const x = 1;\n');

    const ctx = await buildCodebaseContext({ projectDir });
    expect(ctx.techSpec).toBeNull();
    expect(ctx.relevantFiles.map((f) => f.path)).toContain('src/index.ts');
  });

  it('defaults the budget to 50_000 tokens', async () => {
    await scaffoldSampleProject();
    const ctx = await buildCodebaseContext({ projectDir });
    expect(ctx.budget.limitTokens).toBe(DEFAULT_BUDGET_TOKENS);
  });

  it('truncates relevantFiles when total tokens exceed the configured budget', async () => {
    await w('package.json', JSON.stringify({ name: 'demo', dependencies: { next: '^15.0.0' } }));
    // Two source files, each ~25 tokens (100 chars / 4 = 25).
    await w('a.ts', 'a'.repeat(100));
    await w('b.ts', 'b'.repeat(100));

    const ctx = await buildCodebaseContext({ projectDir, budgetTokens: 30 });

    // Budget is 30; package.json is tiny so it fits, plus one of the source
    // files fits. The remaining one must be dropped.
    expect(ctx.budget.truncated).toBe(true);
    expect(ctx.budget.excludedFiles).toBeGreaterThan(0);
    expect(ctx.budget.usedTokens).toBeLessThanOrEqual(30);
    const sourceFilesKept = ctx.relevantFiles.filter((f) => f.path === 'a.ts' || f.path === 'b.ts');
    expect(sourceFilesKept.length).toBeLessThanOrEqual(1);
  });

  it('returns relevantFiles sorted by path', async () => {
    await w('package.json', JSON.stringify({ name: 'demo', dependencies: { next: '^15.0.0' } }));
    await w('z/b.ts', 'export const b = 1;\n');
    await w('a/c.ts', 'export const c = 1;\n');
    await w('a/a.ts', 'export const a = 1;\n');

    const ctx = await buildCodebaseContext({ projectDir });
    const paths = ctx.relevantFiles.map((f) => f.path);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });

  it('propagates PackageJsonMissingError when there is no package.json', async () => {
    await expect(buildCodebaseContext({ projectDir })).rejects.toThrow(/package.json/);
  });
});
