import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImplementationPlan } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DiffApplyError,
  ExecutionAbortedError,
  type PlannedOperation,
  executePlan,
} from './executor.js';
import { PathOutsideProjectError } from './safety.js';

let projectDir: string;

const NOW = () => new Date('2026-05-17T18:22:09.123Z');

async function w(rel: string, content: string): Promise<void> {
  const path = join(projectDir, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

async function exists(rel: string): Promise<boolean> {
  try {
    await stat(join(projectDir, rel));
    return true;
  } catch {
    return false;
  }
}

function makePlan(overrides: Partial<ImplementationPlan> = {}): ImplementationPlan {
  return {
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
        rationale: 'Render Pagination on the users page.',
        full_content:
          'import { Pagination } from "@/components/pagination";\nexport default Page;\n',
      },
    ],
    tests_to_add: [],
    ...overrides,
  };
}

describe('executePlan — dry-run', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-exec-'));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('returns the planned operations without touching the filesystem', async () => {
    await w('src/app/users/page.tsx', 'export default function Page() {}\n');
    const original = await readFile(join(projectDir, 'src/app/users/page.tsx'), 'utf8');

    const result = await executePlan({
      projectDir,
      plan: makePlan(),
      mode: 'dry-run',
      now: NOW,
    });

    expect(result.dryRun).toBe(true);
    expect(result.applied.map((op) => op.kind)).toEqual(['create', 'modify']);
    expect(result.auditLogPath).toBeNull();

    // No files written
    expect(await exists('src/components/pagination.tsx')).toBe(false);
    expect(await readFile(join(projectDir, 'src/app/users/page.tsx'), 'utf8')).toBe(original);
    expect(await exists('.ai/audit')).toBe(false);
  });
});

describe('executePlan — auto mode (happy path)', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-exec-'));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('creates, modifies, and writes an audit log with run-start/op/run-end records', async () => {
    await w('src/app/users/page.tsx', 'export default function Page() {}\n');

    const result = await executePlan({
      projectDir,
      plan: makePlan(),
      mode: 'auto',
      now: NOW,
    });

    expect(result.dryRun).toBe(false);
    expect(result.applied).toHaveLength(2);
    expect(result.rolledBack).toHaveLength(0);
    expect(result.auditLogPath).toBeTruthy();

    expect(await readFile(join(projectDir, 'src/components/pagination.tsx'), 'utf8')).toContain(
      'export const Pagination',
    );
    expect(await readFile(join(projectDir, 'src/app/users/page.tsx'), 'utf8')).toContain(
      'import { Pagination }',
    );

    expect(result.auditLogPath).toBeTruthy();
    const log = await readFile(result.auditLogPath ?? '', 'utf8');
    const lines = log
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines[0].type).toBe('run-start');
    expect(lines.filter((l) => l.type === 'op' && l.outcome === 'applied')).toHaveLength(2);
    expect(lines.at(-1).type).toBe('run-end');
    expect(lines.at(-1).outcome).toBe('success');
  });

  it('applies a unified diff produced by the planner', async () => {
    await w('src/util.ts', 'export const x = 1;\n');
    const plan: ImplementationPlan = {
      feature_slug: 'tweak-util',
      operations: [
        {
          order: 1,
          path: 'src/util.ts',
          operation: 'modify',
          rationale: 'Rename the exported constant from x to y.',
          diff: `Index: src/util.ts
===================================================================
--- src/util.ts
+++ src/util.ts
@@ -1 +1 @@
-export const x = 1;
+export const y = 1;
`,
        },
      ],
      tests_to_add: [],
    };

    const result = await executePlan({ projectDir, plan, mode: 'auto', now: NOW });
    expect(result.applied).toHaveLength(1);
    expect(await readFile(join(projectDir, 'src/util.ts'), 'utf8')).toBe('export const y = 1;\n');
  });

  it('treats plan.tests_to_add entries as create operations appended after main ops', async () => {
    await w('src/app/users/page.tsx', 'export default function Page() {}\n');
    const plan = makePlan({
      tests_to_add: [
        {
          path: 'src/components/pagination.test.tsx',
          content: 'test("renders", () => {});\n',
        },
      ],
    });

    const result = await executePlan({ projectDir, plan, mode: 'auto', now: NOW });
    expect(result.applied).toHaveLength(3);
    expect(result.applied.at(-1)?.kind).toBe('test-create');
    expect(
      await readFile(join(projectDir, 'src/components/pagination.test.tsx'), 'utf8'),
    ).toContain('test("renders"');
  });
});

describe('executePlan — atomic rollback', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-exec-'));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('reverts already-applied operations when a later operation fails', async () => {
    const original = 'export default function Page() {}\n';
    await w('src/app/users/page.tsx', original);

    // The 3rd op points at a non-existent file for delete → it must fail.
    const plan: ImplementationPlan = {
      feature_slug: 'add-pagination',
      operations: [
        {
          order: 1,
          path: 'src/components/pagination.tsx',
          operation: 'create',
          rationale: 'New Pagination component referenced by the users page.',
          full_content: 'export const Pagination = () => null;\n',
        },
        {
          order: 2,
          path: 'src/app/users/page.tsx',
          operation: 'modify',
          rationale: 'Render Pagination on the users page.',
          full_content: 'import { Pagination } from "@/components/pagination";\n',
        },
        {
          order: 3,
          path: 'src/does-not-exist.tsx',
          operation: 'delete',
          rationale: 'Remove the legacy thing that does not actually exist here.',
        },
      ],
      tests_to_add: [],
    };

    await expect(executePlan({ projectDir, plan, mode: 'auto', now: NOW })).rejects.toBeInstanceOf(
      ExecutionAbortedError,
    );

    // Created file reverted (deleted)
    expect(await exists('src/components/pagination.tsx')).toBe(false);
    // Modified file restored to its original content
    expect(await readFile(join(projectDir, 'src/app/users/page.tsx'), 'utf8')).toBe(original);

    // Audit log records the failure and rollback entries
    const auditFiles = await import('node:fs/promises').then((m) =>
      m.readdir(join(projectDir, '.ai', 'audit')),
    );
    expect(auditFiles).toHaveLength(1);
    const auditFile = auditFiles[0];
    if (!auditFile) {
      throw new Error('expected one audit file');
    }
    const log = await readFile(join(projectDir, '.ai', 'audit', auditFile), 'utf8');
    const lines = log
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines.some((l) => l.type === 'op' && l.outcome === 'failed')).toBe(true);
    expect(lines.filter((l) => l.type === 'rollback')).toHaveLength(2);
    expect(lines.at(-1).outcome).toBe('failure');
  });

  it('attaches applied/rolledBack lists to ExecutionAbortedError for the caller', async () => {
    await w('src/app/users/page.tsx', 'original\n');
    const plan: ImplementationPlan = {
      feature_slug: 'tweak',
      operations: [
        {
          order: 1,
          path: 'src/app/users/page.tsx',
          operation: 'modify',
          rationale: 'Update the users page content.',
          full_content: 'updated\n',
        },
        {
          order: 2,
          path: 'src/missing.tsx',
          operation: 'modify',
          rationale: 'Touch a non-existent file to trigger the rollback path.',
          full_content: 'should not be written',
        },
      ],
      tests_to_add: [],
    };

    try {
      await executePlan({ projectDir, plan, mode: 'auto', now: NOW });
      throw new Error('expected ExecutionAbortedError');
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutionAbortedError);
      const e = error as ExecutionAbortedError;
      expect(e.applied.map((o) => o.path)).toEqual(['src/app/users/page.tsx']);
      expect(e.rolledBack.map((o) => o.path)).toEqual(['src/app/users/page.tsx']);
      expect(e.failed.path).toBe('src/missing.tsx');
    }
  });
});

describe('executePlan — safety rules', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-exec-'));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('refuses to touch a path that escapes the project root', async () => {
    const plan: ImplementationPlan = {
      feature_slug: 'escape',
      operations: [
        {
          order: 1,
          path: '../outside.ts',
          operation: 'create',
          rationale: 'Attempts to escape the project root via relative traversal.',
          full_content: 'pwned',
        },
      ],
      tests_to_add: [],
    };
    await expect(executePlan({ projectDir, plan, mode: 'auto', now: NOW })).rejects.toBeInstanceOf(
      PathOutsideProjectError,
    );
  });

  it('refuses to create a file that already exists', async () => {
    await w('src/util.ts', 'preexisting\n');
    const plan: ImplementationPlan = {
      feature_slug: 'add-util',
      operations: [
        {
          order: 1,
          path: 'src/util.ts',
          operation: 'create',
          rationale: 'Tries to create over an existing file (should be rejected).',
          full_content: 'new content',
        },
      ],
      tests_to_add: [],
    };
    await expect(executePlan({ projectDir, plan, mode: 'auto', now: NOW })).rejects.toBeInstanceOf(
      ExecutionAbortedError,
    );
    // File untouched
    expect(await readFile(join(projectDir, 'src/util.ts'), 'utf8')).toBe('preexisting\n');
  });

  it('refuses to modify a non-existent file', async () => {
    const plan: ImplementationPlan = {
      feature_slug: 'modify-missing',
      operations: [
        {
          order: 1,
          path: 'src/missing.ts',
          operation: 'modify',
          rationale: 'Tries to modify a file that does not exist.',
          full_content: 'should not be written',
        },
      ],
      tests_to_add: [],
    };
    await expect(executePlan({ projectDir, plan, mode: 'auto', now: NOW })).rejects.toBeInstanceOf(
      ExecutionAbortedError,
    );
  });

  it('raises DiffApplyError when a diff does not apply cleanly', async () => {
    await w('src/util.ts', 'totally different content\n');
    const plan: ImplementationPlan = {
      feature_slug: 'bad-diff',
      operations: [
        {
          order: 1,
          path: 'src/util.ts',
          operation: 'modify',
          rationale: 'Diff is against a different baseline; will not apply.',
          diff: `--- src/util.ts
+++ src/util.ts
@@ -1 +1 @@
-export const x = 1;
+export const y = 1;
`,
        },
      ],
      tests_to_add: [],
    };

    try {
      await executePlan({ projectDir, plan, mode: 'auto', now: NOW });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutionAbortedError);
      const cause = (error as ExecutionAbortedError).cause;
      expect(cause).toBeInstanceOf(DiffApplyError);
    }
  });
});

describe('executePlan — step-by-step mode', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-exec-'));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('skips an operation when the confirmation callback returns false', async () => {
    await w('src/app/users/page.tsx', 'original\n');
    const onBeforeOperation = vi
      .fn<(op: PlannedOperation) => Promise<boolean>>()
      .mockImplementation(async (op) => op.kind !== 'modify');

    const result = await executePlan({
      projectDir,
      plan: makePlan(),
      mode: 'step-by-step',
      onBeforeOperation,
      now: NOW,
    });

    expect(result.applied.map((op) => op.kind)).toEqual(['create']);
    expect(result.skipped.map((op) => op.kind)).toEqual(['modify']);
    // The skipped modify did not happen
    expect(await readFile(join(projectDir, 'src/app/users/page.tsx'), 'utf8')).toBe('original\n');
  });

  it('throws when step-by-step mode is requested without a callback', async () => {
    await expect(
      executePlan({ projectDir, plan: makePlan(), mode: 'step-by-step', now: NOW }),
    ).rejects.toThrow(/onBeforeOperation is required/);
  });
});
