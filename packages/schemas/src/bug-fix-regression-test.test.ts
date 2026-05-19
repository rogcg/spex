import { describe, expect, it } from 'vitest';
import { RegressionTestSchema } from './bug-fix-regression-test.js';

const valid = {
  path: 'src/components/pagination.test.tsx',
  content: 'import { Pagination } from "./pagination";\ntest("renders", () => {});\n',
  framework: 'vitest' as const,
  rationale: 'Reproduces the bug: pagination resets after filter change due to key prop.',
};

describe('RegressionTestSchema', () => {
  it('accepts a valid vitest regression test', () => {
    expect(RegressionTestSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a jest regression test', () => {
    expect(RegressionTestSchema.safeParse({ ...valid, framework: 'jest' }).success).toBe(true);
  });

  it('accepts a .spec.ts path', () => {
    expect(
      RegressionTestSchema.safeParse({ ...valid, path: 'tests/pagination.spec.ts' }).success,
    ).toBe(true);
  });

  it('rejects a path missing the .test/.spec suffix', () => {
    expect(
      RegressionTestSchema.safeParse({ ...valid, path: 'src/components/pagination.tsx' }).success,
    ).toBe(false);
  });

  it('rejects an unknown framework', () => {
    expect(RegressionTestSchema.safeParse({ ...valid, framework: 'mocha' }).success).toBe(false);
  });

  it('rejects an empty content', () => {
    expect(RegressionTestSchema.safeParse({ ...valid, content: '' }).success).toBe(false);
  });

  it('rejects a too-short rationale', () => {
    expect(RegressionTestSchema.safeParse({ ...valid, rationale: 'short' }).success).toBe(false);
  });
});
