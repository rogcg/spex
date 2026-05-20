import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ExecutorMode,
  buildCodebaseContext,
  buildFeatureCommitMessage,
  buildTestsCommitMessage,
  commitPaths,
  createBranch,
  defaultBranchName,
  executePlan,
  generateFeatureSpec,
  generateImplementationPlan,
  validatePlanIntegrity,
  writeFeatureSpec,
} from '@spex/core';
import type { LLMProvider } from '@spex/core';
import type { FeatureSpec, ImplementationPlan } from '@spex/schemas';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { collectCommitGroups } from './implement-helpers.js';

// End-to-end happy-path validation for the `spex implement` pipeline.
// Exercises the full flow against a real filesystem and a real git repo,
// using a mocked LLMProvider so the test stays deterministic and offline.

const techSpec = {
  version: 1,
  project: {
    name: 'demo-app',
    type: 'web-application',
    description: 'A small internal admin tool with a user listing.',
  },
  context: {
    primary_users: 'Internal team',
    expected_scale: 'Less than 100 users',
    auth_requirements: 'OAuth (Google, GitHub, etc.)',
    data_persistence: 'Relational database',
  },
  stack: {
    label: 'Next.js 15 App Router + Tailwind',
    source: 'recommended',
    components: [
      { role: 'framework', choice: 'Next.js 15 App Router', rationale: 'SSR web app' },
      { role: 'styling', choice: 'Tailwind CSS', rationale: 'Rapid styling' },
    ],
    tradeoffs: [],
    validation_warnings: [],
  },
  rationale:
    'Next.js with App Router and Tailwind provides a strong DX and supports server components for this internal admin tool.',
};

const featureSpec: FeatureSpec = {
  version: 1,
  feature: {
    slug: 'add-pagination-to-user-list',
    title: 'Add pagination to user list',
    description:
      'Paginates the existing user list page by 25 rows per page using a `page` query param.',
  },
  scope: {
    in: ['page-number stored in URL query string', 'server-rendered pagination controls'],
    out: ['infinite scroll', 'changing the default page size'],
  },
  technical_approach:
    'Add a `page` query param to /users, read it in the server component, and pass start/limit to the data loader.',
  files_affected: [
    { path: 'src/app/users/page.tsx', operation: 'modify' },
    { path: 'src/components/pagination.tsx', operation: 'create' },
  ],
  test_cases: [
    'renders the first page by default',
    'navigates to page 2 when the next button is clicked',
  ],
  rationale:
    'Matches the existing App Router conventions and stays close to URL-driven navigation.',
};

const newUsersPage = `import { Pagination } from "@/components/pagination";

export default function UsersPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Number(searchParams.page ?? '1');
  return (
    <main>
      <h1>Users</h1>
      <Pagination currentPage={page} />
    </main>
  );
}
`;

const newPaginationComponent = `export function Pagination({ currentPage }: { currentPage: number }) {
  return (
    <nav aria-label="Pagination">
      <span>Page {currentPage}</span>
    </nav>
  );
}
`;

const newPaginationTest = `import { Pagination } from "./pagination";

describe('Pagination', () => {
  it('renders the current page number', () => {
    expect(typeof Pagination).toBe('function');
  });
});
`;

const implementationPlan: ImplementationPlan = {
  feature_slug: 'add-pagination-to-user-list',
  operations: [
    {
      order: 1,
      path: 'src/components/pagination.tsx',
      operation: 'create',
      rationale:
        'New presentational component for pagination controls referenced by the users page.',
      full_content: newPaginationComponent,
    },
    {
      order: 2,
      path: 'src/app/users/page.tsx',
      operation: 'modify',
      rationale: 'Read the `page` query param and render the new Pagination component.',
      full_content: newUsersPage,
    },
  ],
  tests_to_add: [
    {
      path: 'src/components/pagination.test.tsx',
      content: newPaginationTest,
    },
  ],
};

class StubLLM implements LLMProvider {
  public calls = 0;
  async generateStructured<T>(opts: {
    systemPrompt: string;
    userPrompt: string;
    schema: unknown;
  }): Promise<T> {
    this.calls += 1;
    // The first structured call is for the feature spec; the second is for
    // the implementation plan. The CLI flow makes exactly two calls.
    if (this.calls === 1) {
      return featureSpec as T;
    }
    if (this.calls === 2) {
      return implementationPlan as T;
    }
    throw new Error(`Unexpected LLM call #${this.calls}`);
  }
}

let projectDir: string;

async function w(rel: string, content: string): Promise<void> {
  const path = join(projectDir, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

async function scaffoldDemoProject(): Promise<void> {
  await w(
    'package.json',
    JSON.stringify(
      {
        name: 'demo-app',
        version: '0.1.0',
        scripts: { dev: 'next dev', build: 'next build', test: 'vitest' },
        dependencies: { next: '^15.0.0', react: '^19.0.0' },
        devDependencies: { typescript: '^5.0.0', vitest: '^2.0.0' },
      },
      null,
      2,
    ),
  );
  await w('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }));
  await w('.gitignore', 'node_modules\n.next\n');
  await w('src/app/page.tsx', 'export default function Home() { return <h1>Home</h1>; }\n');
  await w(
    'src/app/users/page.tsx',
    'export default function UsersPage() {\n  return <h1>Users</h1>;\n}\n',
  );
  await mkdir(join(projectDir, '.ai'), { recursive: true });
  await writeFile(join(projectDir, '.ai', 'tech-spec.yaml'), stringifyYaml(techSpec), 'utf8');
  await writeFile(
    join(projectDir, '.ai', 'README.md'),
    '# .ai/\n\nSPEX-managed artifacts.\n',
    'utf8',
  );
  // Initialise git so the implement flow can branch and commit.
  await execa('git', ['init', '--initial-branch=main'], { cwd: projectDir });
  await execa('git', ['config', 'user.email', 'spex-test@example.com'], { cwd: projectDir });
  await execa('git', ['config', 'user.name', 'SPEX Test'], { cwd: projectDir });
  await execa('git', ['config', 'commit.gpgSign', 'false'], { cwd: projectDir });
  await execa('git', ['add', '.'], { cwd: projectDir });
  await execa('git', ['commit', '-m', 'initial scaffold'], { cwd: projectDir });
}

describe('spex implement — end-to-end (mocked LLM, real filesystem, real git)', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-e2e-'));
    await scaffoldDemoProject();
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('walks the full implement pipeline and produces two structured commits on a feature branch', async () => {
    const llm = new StubLLM();
    const description = 'add pagination to user listing';
    const mode: ExecutorMode = 'auto';

    // Phase 1 — Context
    const context = await buildCodebaseContext({ projectDir });
    expect(context.relevantFiles.map((f) => f.path)).toContain('src/app/users/page.tsx');
    expect(context.techSpec?.project.name).toBe('demo-app');
    expect(context.detectedPatterns.componentStructure).not.toBe('unknown');

    // Phase 2 — Feature spec generation (mocked)
    const spec = await generateFeatureSpec({ llm, description, context });
    expect(spec.feature.slug).toBe('add-pagination-to-user-list');

    // Phase 3 — Plan generation (mocked) + integrity check
    const plan = await generateImplementationPlan({ llm, featureSpec: spec, context });
    expect(() => validatePlanIntegrity(plan, { featureSpec: spec })).not.toThrow();

    // Phase 4 — Branch, write spec, execute
    const branch = defaultBranchName(spec.feature.slug);
    await createBranch({ projectDir, branch });

    const writeResult = await writeFeatureSpec({ projectDir, spec });
    expect(writeResult.relativePath).toBe(join('.ai', 'specs', 'add-pagination-to-user-list.yaml'));
    const writtenYaml = await readFile(writeResult.absolutePath, 'utf8');
    expect(writtenYaml).toContain('slug: add-pagination-to-user-list');

    const executorResult = await executePlan({ projectDir, plan, mode });
    expect(executorResult.dryRun).toBe(false);
    expect(executorResult.applied.map((op) => op.kind)).toEqual([
      'create',
      'modify',
      'test-create',
    ]);
    expect(executorResult.rolledBack).toHaveLength(0);
    expect(executorResult.auditLogPath).toBeTruthy();

    // Files on disk match the plan
    expect(await readFile(join(projectDir, 'src/components/pagination.tsx'), 'utf8')).toContain(
      'export function Pagination',
    );
    expect(await readFile(join(projectDir, 'src/app/users/page.tsx'), 'utf8')).toContain(
      'import { Pagination }',
    );
    expect(
      await readFile(join(projectDir, 'src/components/pagination.test.tsx'), 'utf8'),
    ).toContain("describe('Pagination'");

    // Phase 5 — Commits
    const groups = collectCommitGroups({
      projectDir,
      executorResult,
      featureSpecRelativePath: writeResult.relativePath,
    });
    expect(groups.sourcePaths).toContain('.ai/specs/add-pagination-to-user-list.yaml');
    expect(groups.sourcePaths).toContain('src/components/pagination.tsx');
    expect(groups.sourcePaths).toContain('src/app/users/page.tsx');
    expect(groups.testPaths).toEqual(['src/components/pagination.test.tsx']);

    const sourceCommit = await commitPaths({
      projectDir,
      paths: groups.sourcePaths,
      message: buildFeatureCommitMessage(spec),
    });
    expect(sourceCommit.sha).toMatch(/^[0-9a-f]{40}$/);

    const testCommit = await commitPaths({
      projectDir,
      paths: groups.testPaths,
      message: buildTestsCommitMessage(spec),
    });
    expect(testCommit.sha).toMatch(/^[0-9a-f]{40}$/);

    // Verify both commits landed on the feature branch with the right messages
    const { stdout: log } = await execa(
      'git',
      ['log', '--pretty=format:%s%n%b%n---', '-2', branch],
      { cwd: projectDir },
    );
    expect(log).toContain('test(users): add tests for add-pagination-to-user-list');
    expect(log).toContain('feat(users): Add pagination to user list');
    expect(log).toContain('Feature spec: .ai/specs/add-pagination-to-user-list.yaml');

    // Working tree is clean after the run
    const { stdout: status } = await execa('git', ['status', '--porcelain'], { cwd: projectDir });
    expect(status).toBe('');

    // Exactly one audit log exists
    const auditFiles = await readdir(join(projectDir, '.ai', 'audit'));
    expect(auditFiles).toHaveLength(1);

    // LLM was called exactly twice (spec + plan)
    expect(llm.calls).toBe(2);
  });

  it('dry-run mode leaves the filesystem and git history unchanged', async () => {
    const llm = new StubLLM();
    const context = await buildCodebaseContext({ projectDir });
    const spec = await generateFeatureSpec({ llm, description: 'add pagination', context });
    const plan = await generateImplementationPlan({ llm, featureSpec: spec, context });

    const before = await readFile(join(projectDir, 'src/app/users/page.tsx'), 'utf8');
    const { stdout: branchBefore } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectDir,
    });

    const result = await executePlan({ projectDir, plan, mode: 'dry-run' });

    expect(result.dryRun).toBe(true);
    expect(result.auditLogPath).toBeNull();
    // No files written
    expect(await readFile(join(projectDir, 'src/app/users/page.tsx'), 'utf8')).toBe(before);
    // No .ai/specs/ created either (dry-run shouldn't touch the disk)
    let specsExists = true;
    try {
      await readdir(join(projectDir, '.ai', 'specs'));
    } catch {
      specsExists = false;
    }
    expect(specsExists).toBe(false);
    // No new commits, still on main
    const { stdout: branchAfter } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectDir,
    });
    expect(branchAfter).toBe(branchBefore);
  });
});
