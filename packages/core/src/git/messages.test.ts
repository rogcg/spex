import type { FeatureSpec } from '@spex/schemas';
import { describe, expect, it } from 'vitest';
import {
  buildFeatureCommitMessage,
  buildTestsCommitMessage,
  inferCommitScope,
} from './messages.js';

function makeSpec(overrides: Partial<FeatureSpec> = {}): FeatureSpec {
  return {
    version: 1,
    feature: {
      slug: 'add-pagination',
      title: 'Add pagination to user list',
      description: 'Paginates the existing user list page by 25 rows per page.',
    },
    scope: { in: ['page query param'], out: [] },
    technical_approach:
      'Add a page query param to the users route and slice the dataset accordingly.',
    files_affected: [{ path: 'src/app/users/page.tsx', operation: 'modify' }],
    test_cases: ['renders page 1 by default'],
    rationale: 'Stays consistent with App Router conventions and URL-driven navigation.',
    ...overrides,
  };
}

describe('inferCommitScope', () => {
  it('uses the directory containing the file, skipping generic src wrappers', () => {
    expect(inferCommitScope(makeSpec())).toBe('users');
  });

  it('skips a top-level packages/ wrapper', () => {
    const spec = makeSpec({
      files_affected: [{ path: 'packages/core/src/x.ts', operation: 'modify' }],
    });
    expect(inferCommitScope(spec)).toBe('src');
  });

  it('handles src/components/<file> directly', () => {
    const spec = makeSpec({
      files_affected: [{ path: 'src/components/button.tsx', operation: 'create' }],
    });
    expect(inferCommitScope(spec)).toBe('components');
  });

  it('falls back to the file stem when the file is at the repo root', () => {
    const spec = makeSpec({
      files_affected: [{ path: 'README.md', operation: 'modify' }],
    });
    expect(inferCommitScope(spec)).toBe('README');
  });

  it('falls back to the feature slug when files_affected is empty-ish', () => {
    const spec = makeSpec({
      files_affected: [{ path: '', operation: 'modify' }],
    });
    expect(inferCommitScope(spec)).toBe('add-pagination');
  });
});

describe('buildFeatureCommitMessage', () => {
  it('uses the Conventional Commits feat(scope) format', () => {
    const msg = buildFeatureCommitMessage(makeSpec());
    expect(msg.split('\n')[0]).toBe('feat(users): Add pagination to user list');
  });

  it('includes the feature description in the body', () => {
    expect(buildFeatureCommitMessage(makeSpec())).toContain(
      'Paginates the existing user list page by 25 rows per page.',
    );
  });

  it('includes a feature spec reference for traceability', () => {
    expect(buildFeatureCommitMessage(makeSpec())).toContain(
      'Feature spec: .ai/specs/add-pagination.yaml',
    );
  });
});

describe('buildTestsCommitMessage', () => {
  it('uses the Conventional Commits test(scope) format with the feature slug', () => {
    expect(buildTestsCommitMessage(makeSpec()).split('\n')[0]).toBe(
      'test(users): add tests for add-pagination',
    );
  });

  it('includes a feature spec reference', () => {
    expect(buildTestsCommitMessage(makeSpec())).toContain(
      'Feature spec: .ai/specs/add-pagination.yaml',
    );
  });
});
