import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider } from '@spex/core';
import type { FeatureSpec, ImplementationPlan } from '@spex/schemas';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { spexImplementToolDefinition } from './spex-implement.js';

const techSpec = {
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
      { role: 'framework', choice: 'Next.js 15 App Router', rationale: 'SSR web app' },
      { role: 'styling', choice: 'Tailwind CSS', rationale: 'Styling' },
    ],
    tradeoffs: [],
    validation_warnings: [],
  },
  rationale: 'Next.js App Router with Tailwind for a small internal tool — straightforward DX.',
};

const featureSpec: FeatureSpec = {
  version: 1,
  feature: {
    slug: 'add-tagline',
    title: 'Add tagline to homepage',
    description: 'Shows a short tagline on the homepage above the title.',
  },
  scope: { in: ['render tagline element'], out: [] },
  technical_approach: 'Add a paragraph element above the existing h1 in the homepage component.',
  files_affected: [{ path: 'src/app/page.tsx', operation: 'modify' }],
  test_cases: ['renders the tagline'],
  rationale: 'Smallest change that demonstrates the implement flow without new components.',
};

const plan: ImplementationPlan = {
  feature_slug: 'add-tagline',
  operations: [
    {
      order: 1,
      path: 'src/app/page.tsx',
      operation: 'modify',
      rationale: 'Render the tagline paragraph above the existing heading.',
      full_content:
        'export default function Home() {\n  return (\n    <main>\n      <p>Pithy tagline.</p>\n      <h1>Home</h1>\n    </main>\n  );\n}\n',
    },
  ],
  tests_to_add: [],
};

let projectDir: string;

async function scaffoldProject(): Promise<void> {
  await writeFile(
    join(projectDir, 'package.json'),
    JSON.stringify({
      name: 'demo-app',
      version: '0.1.0',
      dependencies: { next: '^15.0.0', react: '^19.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    }),
  );
  await writeFile(join(projectDir, 'tsconfig.json'), '{}');
  await writeFile(join(projectDir, '.gitignore'), 'node_modules\n.next\n');
  await mkdir(join(projectDir, 'src', 'app'), { recursive: true });
  await writeFile(
    join(projectDir, 'src', 'app', 'page.tsx'),
    'export default function Home() {\n  return <h1>Home</h1>;\n}\n',
  );
  await mkdir(join(projectDir, '.ai'), { recursive: true });
  await writeFile(join(projectDir, '.ai', 'tech-spec.yaml'), stringifyYaml(techSpec), 'utf8');
  await execa('git', ['init', '--initial-branch=main'], { cwd: projectDir });
  await execa('git', ['config', 'user.email', 'spex-test@example.com'], { cwd: projectDir });
  await execa('git', ['config', 'user.name', 'SPEX Test'], { cwd: projectDir });
  await execa('git', ['config', 'commit.gpgSign', 'false'], { cwd: projectDir });
  await execa('git', ['add', '.'], { cwd: projectDir });
  await execa('git', ['commit', '-m', 'initial'], { cwd: projectDir });
}

function stubLlm(): LLMProvider {
  const fn = vi.fn();
  fn.mockResolvedValueOnce(featureSpec); // feature spec call
  fn.mockResolvedValueOnce(plan); // plan call
  return { generateStructured: fn };
}

function parseTextPayload(content: unknown): Record<string, unknown> {
  if (!content || typeof content !== 'object') throw new Error('no content');
  const text = (content as { text?: unknown }).text;
  if (typeof text !== 'string') throw new Error('content has no text');
  return JSON.parse(text) as Record<string, unknown>;
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'spex-mcp-impl-'));
  await scaffoldProject();
});
afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('spexImplementToolDefinition', () => {
  it('advertises spex_implement requiring only description', () => {
    expect(spexImplementToolDefinition.tool.name).toBe('spex_implement');
    const schema = spexImplementToolDefinition.tool.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.required).toEqual(['description']);
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['description', 'project_dir', 'dry_run', 'no_git']),
    );
  });

  it('rejects invalid input', async () => {
    const result = await spexImplementToolDefinition.handle({}, {});
    expect(result.isError).toBe(true);
    expect(parseTextPayload(result.content?.[0]).message).toContain('Invalid input');
  });

  it('runs the full pipeline and produces two commits on a feature branch', async () => {
    const llm = stubLlm();
    const result = await spexImplementToolDefinition.handle(
      { description: 'add a tagline to the homepage', project_dir: projectDir },
      { llm },
    );

    expect(result.isError).toBeFalsy();
    const payload = parseTextPayload(result.content?.[0]);
    expect(payload.status).toBe('success');
    expect(payload.branch).toBe('feature/add-tagline');
    expect(payload.applied).toEqual([{ order: 1, kind: 'modify', path: 'src/app/page.tsx' }]);
    expect((payload.commits as { feat: string }).feat).toMatch(/^[0-9a-f]{40}$/);

    const newPage = await readFile(join(projectDir, 'src', 'app', 'page.tsx'), 'utf8');
    expect(newPage).toContain('Pithy tagline');

    const { stdout: branchName } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectDir,
    });
    expect(branchName.trim()).toBe('feature/add-tagline');

    const { stdout: log } = await execa('git', ['log', '-1', '--pretty=%B'], {
      cwd: projectDir,
    });
    // inferCommitScope strips `src/` and `app/` wrappers; only `page.tsx`
    // remains, so the scope falls back to the stem `page`.
    expect(log).toContain('feat(page): Add tagline to homepage');
    expect(log).toContain('Feature spec: .ai/specs/add-tagline.yaml');

    const auditFiles = await readdir(join(projectDir, '.ai', 'audit'));
    expect(auditFiles).toHaveLength(1);
  });

  it('respects dry_run mode (no writes, no git)', async () => {
    const llm = stubLlm();
    const original = await readFile(join(projectDir, 'src', 'app', 'page.tsx'), 'utf8');

    const result = await spexImplementToolDefinition.handle(
      { description: 'add a tagline to the homepage', project_dir: projectDir, dry_run: true },
      { llm },
    );

    expect(result.isError).toBeFalsy();
    const payload = parseTextPayload(result.content?.[0]);
    expect(payload.dry_run).toBe(true);
    expect(payload.wouldApply).toBeDefined();
    expect(await readFile(join(projectDir, 'src', 'app', 'page.tsx'), 'utf8')).toBe(original);

    const { stdout: branch } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectDir,
    });
    expect(branch.trim()).toBe('main');
  });

  it('reports a clear error when the working tree is dirty', async () => {
    await writeFile(join(projectDir, 'dirty.txt'), 'uncommitted change');
    const llm = stubLlm();
    const result = await spexImplementToolDefinition.handle(
      { description: 'add a tagline', project_dir: projectDir },
      { llm },
    );
    expect(result.isError).toBe(true);
    expect(parseTextPayload(result.content?.[0]).message).toContain('uncommitted changes');
  });
});
