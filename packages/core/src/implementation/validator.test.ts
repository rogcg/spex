import type { FeatureSpec, ImplementationPlan } from '@spex/schemas';
import { describe, expect, it } from 'vitest';
import { InvalidPlanError, validatePlanIntegrity } from './validator.js';

const featureSpec: FeatureSpec = {
  version: 1,
  feature: {
    slug: 'add-pagination',
    title: 'Add pagination',
    description: 'Paginates the user list page.',
  },
  scope: { in: ['page query param'], out: [] },
  technical_approach:
    'Add a `page` query param to the users route and slice the dataset accordingly.',
  files_affected: [{ path: 'src/app/users/page.tsx', operation: 'modify' }],
  test_cases: ['renders page 1 by default'],
  rationale: 'Stays consistent with App Router conventions and URL-driven navigation.',
};

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
        diff: '@@ -1 +1,2 @@\n+import { Pagination } from "@/components/pagination";\n',
      },
    ],
    tests_to_add: [],
    ...overrides,
  };
}

describe('validatePlanIntegrity', () => {
  it('passes a well-formed plan without options', () => {
    expect(() => validatePlanIntegrity(makePlan())).not.toThrow();
  });

  it('passes when feature_slug matches the provided featureSpec', () => {
    expect(() => validatePlanIntegrity(makePlan(), { featureSpec })).not.toThrow();
  });

  it('throws InvalidPlanError when order numbers are not contiguous starting at 1', () => {
    const plan = makePlan({
      operations: [
        {
          order: 2,
          path: 'a.ts',
          operation: 'create',
          rationale: 'Some valid rationale text.',
          full_content: 'x',
        },
        {
          order: 3,
          path: 'b.ts',
          operation: 'create',
          rationale: 'Another valid rationale text.',
          full_content: 'y',
        },
      ],
    });
    expect(() => validatePlanIntegrity(plan)).toThrow(InvalidPlanError);
  });

  it('throws InvalidPlanError when order numbers have duplicates', () => {
    const plan = makePlan({
      operations: [
        {
          order: 1,
          path: 'a.ts',
          operation: 'create',
          rationale: 'Some valid rationale text.',
          full_content: 'x',
        },
        {
          order: 1,
          path: 'b.ts',
          operation: 'create',
          rationale: 'Another valid rationale text.',
          full_content: 'y',
        },
      ],
    });
    expect(() => validatePlanIntegrity(plan)).toThrow(InvalidPlanError);
  });

  it('throws InvalidPlanError when two operations share the same path and operation', () => {
    const plan = makePlan({
      operations: [
        {
          order: 1,
          path: 'src/components/pagination.tsx',
          operation: 'create',
          rationale: 'First create rationale text.',
          full_content: 'x',
        },
        {
          order: 2,
          path: 'src/components/pagination.tsx',
          operation: 'create',
          rationale: 'Second create rationale text.',
          full_content: 'y',
        },
      ],
    });
    expect(() => validatePlanIntegrity(plan)).toThrow(InvalidPlanError);
  });

  it('throws InvalidPlanError when tests_to_add has duplicate paths', () => {
    const plan = makePlan({
      tests_to_add: [
        { path: 'src/greet.test.ts', content: 'test 1' },
        { path: 'src/greet.test.ts', content: 'test 2' },
      ],
    });
    expect(() => validatePlanIntegrity(plan)).toThrow(InvalidPlanError);
  });

  it('throws InvalidPlanError when a test path also appears in plan.operations', () => {
    const plan = makePlan({
      operations: [
        {
          order: 1,
          path: 'src/greet.test.ts',
          operation: 'create',
          rationale: 'Source op accidentally targets a test file path.',
          full_content: '// content',
        },
      ],
      tests_to_add: [{ path: 'src/greet.test.ts', content: 'test content' }],
    });
    expect(() => validatePlanIntegrity(plan)).toThrow(InvalidPlanError);
  });

  it('throws InvalidPlanError when feature_slug does not match featureSpec.slug', () => {
    const plan = makePlan({ feature_slug: 'other-feature' });
    expect(() => validatePlanIntegrity(plan, { featureSpec })).toThrow(InvalidPlanError);
  });

  it('attaches the list of violations to the thrown error', () => {
    const plan = makePlan({
      feature_slug: 'other-feature',
      operations: [
        {
          order: 5,
          path: 'a.ts',
          operation: 'create',
          rationale: 'Some valid rationale text.',
          full_content: 'x',
        },
      ],
    });
    try {
      validatePlanIntegrity(plan, { featureSpec });
      throw new Error('expected InvalidPlanError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPlanError);
      const violations = (error as InvalidPlanError).violations;
      expect(violations.some((v) => v.includes('order numbers'))).toBe(true);
      expect(violations.some((v) => v.includes('feature_slug'))).toBe(true);
    }
  });
});
