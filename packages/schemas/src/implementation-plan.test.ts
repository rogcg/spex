import { describe, expect, it } from 'vitest';
import { ImplementationPlanSchema } from './implementation-plan.js';

const create = {
  order: 1,
  path: 'src/components/pagination.tsx',
  operation: 'create' as const,
  rationale: 'New presentational component for the pagination controls.',
  full_content: 'export const Pagination = () => null;\n',
};

const modify = {
  order: 2,
  path: 'src/app/users/page.tsx',
  operation: 'modify' as const,
  rationale: 'Read the `page` query param and render the new Pagination component.',
  diff: '@@ -1,3 +1,5 @@\n+import { Pagination } from "@/components/pagination";\n',
};

const del = {
  order: 3,
  path: 'src/legacy/pager.tsx',
  operation: 'delete' as const,
  rationale: 'Remove the legacy pager superseded by the new Pagination component.',
};

const valid = {
  feature_slug: 'add-pagination',
  operations: [create, modify, del],
  tests_to_add: [
    {
      path: 'src/components/pagination.test.tsx',
      content: 'import { Pagination } from "./pagination";\ntest("renders", () => {});\n',
    },
  ],
};

describe('ImplementationPlanSchema', () => {
  it('accepts a valid plan with create/modify/delete operations', () => {
    expect(ImplementationPlanSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts an empty tests_to_add', () => {
    expect(ImplementationPlanSchema.safeParse({ ...valid, tests_to_add: [] }).success).toBe(true);
  });

  it('rejects when operations is empty', () => {
    expect(ImplementationPlanSchema.safeParse({ ...valid, operations: [] }).success).toBe(false);
  });

  it('rejects a feature_slug that is not kebab-case', () => {
    expect(ImplementationPlanSchema.safeParse({ ...valid, feature_slug: 'NotKebab' }).success).toBe(
      false,
    );
  });

  it('rejects a create operation missing full_content', () => {
    const { full_content: _omit, ...badCreate } = create;
    expect(
      ImplementationPlanSchema.safeParse({ ...valid, operations: [badCreate, modify, del] })
        .success,
    ).toBe(false);
  });

  it('rejects a modify operation missing both diff and full_content', () => {
    const { diff: _omit, ...badModify } = modify;
    expect(
      ImplementationPlanSchema.safeParse({ ...valid, operations: [create, badModify, del] })
        .success,
    ).toBe(false);
  });

  it('accepts a modify operation with full_content instead of diff', () => {
    const { diff: _omit, ...modifyWithContent } = modify;
    expect(
      ImplementationPlanSchema.safeParse({
        ...valid,
        operations: [
          create,
          { ...modifyWithContent, full_content: 'export default function Page() {}\n' },
          del,
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects a delete operation that carries full_content', () => {
    expect(
      ImplementationPlanSchema.safeParse({
        ...valid,
        operations: [create, modify, { ...del, full_content: 'should not be here' }],
      }).success,
    ).toBe(false);
  });

  it('rejects when an operation has a too-short rationale', () => {
    expect(
      ImplementationPlanSchema.safeParse({
        ...valid,
        operations: [create, { ...modify, rationale: 'short' }, del],
      }).success,
    ).toBe(false);
  });

  it('rejects when order is not a positive integer', () => {
    expect(
      ImplementationPlanSchema.safeParse({
        ...valid,
        operations: [{ ...create, order: 0 }, modify, del],
      }).success,
    ).toBe(false);
  });
});
