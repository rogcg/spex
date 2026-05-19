import { isAbsolute, relative } from 'node:path';
import type { ExecutorResult, PlannedOperation } from '@spex/core';
import type { ImplementationPlan } from '@spex/schemas';

/**
 * Renders an ImplementationPlan as a human-readable text block suitable for
 * displaying in the terminal during the approval gate. We intentionally keep
 * file content/diffs out of the summary — they are reviewed during step-by-step
 * mode or in the final commit/diff.
 */
export function formatPlanForReview(plan: ImplementationPlan): string {
  const sortedOps = [...plan.operations].sort((a, b) => a.order - b.order);
  const opLines = sortedOps.map((op) => {
    const detail =
      op.operation === 'modify' && op.diff !== undefined
        ? ' (diff)'
        : op.operation === 'modify' && op.full_content !== undefined
          ? ' (full rewrite)'
          : '';
    return `  #${op.order} ${op.operation} ${op.path}${detail}\n      ${op.rationale}`;
  });

  const testLines = plan.tests_to_add.map(
    (test, index) => `  +${index + 1} create ${test.path} (test)`,
  );

  return [
    `feature_slug: ${plan.feature_slug}`,
    `operations (${plan.operations.length}):`,
    opLines.join('\n'),
    `tests_to_add (${plan.tests_to_add.length}):`,
    testLines.length > 0 ? testLines.join('\n') : '  (none)',
  ].join('\n');
}

export interface CommitGroups {
  sourcePaths: string[];
  testPaths: string[];
}

/**
 * Build the two commit groups (source/tests) from what the executor actually
 * applied. Always includes the feature-spec yaml and the audit log in the
 * source group when they exist. Skipped operations are not committed.
 *
 * All paths returned are project-relative (POSIX-style). Paths that resolve
 * outside `projectDir` are silently dropped — we never `git add` outside the
 * project root.
 */
export function collectCommitGroups(opts: {
  projectDir: string;
  executorResult: ExecutorResult;
  featureSpecRelativePath: string;
}): CommitGroups {
  const sourcePaths = new Set<string>();
  const testPaths = new Set<string>();

  for (const op of opts.executorResult.applied) {
    const rel = toRelative(opts.projectDir, op.path);
    if (rel === null) continue;
    if (isTestOperation(op)) {
      testPaths.add(rel);
    } else {
      sourcePaths.add(rel);
    }
  }

  sourcePaths.add(toPosix(opts.featureSpecRelativePath));

  if (opts.executorResult.auditLogPath) {
    const rel = toRelative(opts.projectDir, opts.executorResult.auditLogPath);
    if (rel !== null) {
      sourcePaths.add(rel);
    }
  }

  return {
    sourcePaths: [...sourcePaths].sort(),
    testPaths: [...testPaths].sort(),
  };
}

function isTestOperation(op: PlannedOperation): boolean {
  return op.kind === 'test-create';
}

function toRelative(projectDir: string, path: string): string | null {
  const candidate = isAbsolute(path) ? path : path;
  // For an absolute path, compute relative; for an already-relative path,
  // pass through (after normalising separators).
  const rel = isAbsolute(candidate) ? relative(projectDir, candidate) : candidate;
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
    return null;
  }
  return toPosix(rel);
}

function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}
