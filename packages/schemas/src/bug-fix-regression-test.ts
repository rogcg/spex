import { z } from 'zod';

export const TestFrameworkSchema = z.enum(['vitest', 'jest']);
export type TestFramework = z.infer<typeof TestFrameworkSchema>;

export const RegressionTestSchema = z.object({
  path: z
    .string()
    .min(1)
    .regex(
      /\.(test|spec)\.[cm]?[jt]sx?$/i,
      'path must end in .test.{ts,tsx,js,jsx} or .spec.{ts,tsx,js,jsx} so the test runner picks it up',
    ),
  content: z.string().min(1, 'content is the full test file'),
  framework: TestFrameworkSchema,
  rationale: z.string().min(20, 'rationale must explain why this test reproduces the bug'),
});
export type RegressionTest = z.infer<typeof RegressionTestSchema>;
