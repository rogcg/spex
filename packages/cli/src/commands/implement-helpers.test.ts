import { sep } from 'node:path';
import type { ExecutorResult, PlannedOperation } from '@spex/core';
import type { ImplementationPlan } from '@spex/schemas';
import { describe, expect, it } from 'vitest';
import { collectCommitGroups, formatPlanForReview } from './implement-helpers.js';

const plan: ImplementationPlan = {
  feature_slug: 'add-pagination',
  operations: [
    {
      order: 2,
      path: 'src/app/users/page.tsx',
      operation: 'modify',
      rationale: 'Read the page query param and render Pagination.',
      diff: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n',
    },
    {
      order: 1,
      path: 'src/components/pagination.tsx',
      operation: 'create',
      rationale: 'New presentational component for pagination controls.',
      full_content: 'export const Pagination = () => null;\n',
    },
  ],
  tests_to_add: [
    {
      path: 'src/components/pagination.test.tsx',
      content: 'test("renders", () => {});\n',
    },
  ],
};

describe('formatPlanForReview', () => {
  it('sorts operations by order regardless of input order', () => {
    const out = formatPlanForReview(plan);
    const op1Index = out.indexOf('#1 create');
    const op2Index = out.indexOf('#2 modify');
    expect(op1Index).toBeGreaterThan(0);
    expect(op2Index).toBeGreaterThan(op1Index);
  });

  it('annotates modify operations with their content shape', () => {
    expect(formatPlanForReview(plan)).toContain('#2 modify src/app/users/page.tsx (diff)');
  });

  it('lists tests under a separate section', () => {
    const out = formatPlanForReview(plan);
    expect(out).toContain('tests_to_add (1)');
    expect(out).toContain('+1 create src/components/pagination.test.tsx (test)');
  });

  it('handles an empty tests_to_add list gracefully', () => {
    const out = formatPlanForReview({ ...plan, tests_to_add: [] });
    expect(out).toContain('tests_to_add (0)');
    expect(out).toContain('  (none)');
  });

  it('includes the feature slug at the top', () => {
    expect(formatPlanForReview(plan)).toMatch(/^feature_slug: add-pagination/);
  });
});

function applied(ops: PlannedOperation[]): ExecutorResult {
  return {
    dryRun: false,
    applied: ops,
    skipped: [],
    rolledBack: [],
    auditLogPath: `${sep}tmp${sep}demo${sep}.ai${sep}audit${sep}log.jsonl`,
  };
}

describe('collectCommitGroups', () => {
  const projectDir = `${sep}tmp${sep}demo`;

  it('separates source and test paths from applied operations', () => {
    const result = applied([
      {
        order: 1,
        kind: 'create',
        path: 'src/components/pagination.tsx',
        rationale: 'New pagination component.',
      },
      {
        order: 2,
        kind: 'modify',
        path: 'src/app/users/page.tsx',
        rationale: 'Render pagination.',
      },
      {
        order: 3,
        kind: 'test-create',
        path: 'src/components/pagination.test.tsx',
        rationale: 'Cover the new component with a test.',
      },
    ]);

    const groups = collectCommitGroups({
      projectDir,
      executorResult: result,
      featureSpecRelativePath: '.ai/specs/add-pagination.yaml',
    });

    expect(groups.sourcePaths).toContain('src/components/pagination.tsx');
    expect(groups.sourcePaths).toContain('src/app/users/page.tsx');
    expect(groups.sourcePaths).toContain('.ai/specs/add-pagination.yaml');
    expect(groups.testPaths).toEqual(['src/components/pagination.test.tsx']);
  });

  it('always includes the feature-spec yaml in the source group', () => {
    const groups = collectCommitGroups({
      projectDir,
      executorResult: applied([]),
      featureSpecRelativePath: '.ai/specs/add-pagination.yaml',
    });
    expect(groups.sourcePaths).toContain('.ai/specs/add-pagination.yaml');
    expect(groups.testPaths).toEqual([]);
  });

  it('includes the audit log path in the source group when present', () => {
    const groups = collectCommitGroups({
      projectDir,
      executorResult: applied([]),
      featureSpecRelativePath: '.ai/specs/add-pagination.yaml',
    });
    expect(groups.sourcePaths).toContain('.ai/audit/log.jsonl');
  });

  it('drops paths that resolve outside the project root', () => {
    const result: ExecutorResult = {
      dryRun: false,
      applied: [
        {
          order: 1,
          kind: 'create',
          path: `${sep}etc${sep}passwd`,
          rationale: 'Adversarial absolute path that escapes the project root.',
        },
      ],
      skipped: [],
      rolledBack: [],
      auditLogPath: null,
    };
    const groups = collectCommitGroups({
      projectDir,
      executorResult: result,
      featureSpecRelativePath: '.ai/specs/add-pagination.yaml',
    });
    expect(groups.sourcePaths).toEqual(['.ai/specs/add-pagination.yaml']);
  });

  it('returns sorted, deduplicated path lists', () => {
    const groups = collectCommitGroups({
      projectDir,
      executorResult: applied([
        {
          order: 1,
          kind: 'create',
          path: 'z.ts',
          rationale: 'Adds a new module under z.ts.',
        },
        {
          order: 2,
          kind: 'modify',
          path: 'a.ts',
          rationale: 'Tweaks the existing a.ts module.',
        },
      ]),
      featureSpecRelativePath: '.ai/specs/add-pagination.yaml',
    });
    expect(groups.sourcePaths).toEqual([
      '.ai/audit/log.jsonl',
      '.ai/specs/add-pagination.yaml',
      'a.ts',
      'z.ts',
    ]);
  });
});
