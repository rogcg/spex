import { describe, expect, it } from 'vitest';
import { FeatureSpecSchema } from './feature-spec.js';

const valid = {
  version: 1,
  feature: {
    slug: 'add-pagination-to-user-list',
    title: 'Add pagination to user list',
    description: 'Paginates the existing user list page by 25 rows per page.',
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
    'Matches the existing App Router conventions and avoids client-side state for navigation.',
};

describe('FeatureSpecSchema', () => {
  it('accepts a valid feature spec', () => {
    expect(FeatureSpecSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects when version is not literal 1', () => {
    const r = FeatureSpecSchema.safeParse({ ...valid, version: 2 });
    expect(r.success).toBe(false);
  });

  it('rejects a slug that is not kebab-case', () => {
    const r = FeatureSpecSchema.safeParse({
      ...valid,
      feature: { ...valid.feature, slug: 'AddPaginationToUserList' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects a slug that starts with a dash', () => {
    const r = FeatureSpecSchema.safeParse({
      ...valid,
      feature: { ...valid.feature, slug: '-pagination' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects when scope.in is empty', () => {
    const r = FeatureSpecSchema.safeParse({
      ...valid,
      scope: { in: [], out: valid.scope.out },
    });
    expect(r.success).toBe(false);
  });

  it('accepts an empty scope.out', () => {
    const r = FeatureSpecSchema.safeParse({
      ...valid,
      scope: { in: valid.scope.in, out: [] },
    });
    expect(r.success).toBe(true);
  });

  it('rejects when files_affected is empty', () => {
    const r = FeatureSpecSchema.safeParse({ ...valid, files_affected: [] });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown operation on a file change', () => {
    const r = FeatureSpecSchema.safeParse({
      ...valid,
      files_affected: [{ path: 'src/x.ts', operation: 'rename' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects when test_cases is empty', () => {
    const r = FeatureSpecSchema.safeParse({ ...valid, test_cases: [] });
    expect(r.success).toBe(false);
  });

  it('rejects a too-short technical_approach', () => {
    const r = FeatureSpecSchema.safeParse({ ...valid, technical_approach: 'short' });
    expect(r.success).toBe(false);
  });

  it('rejects a too-short rationale', () => {
    const r = FeatureSpecSchema.safeParse({ ...valid, rationale: 'short' });
    expect(r.success).toBe(false);
  });
});
