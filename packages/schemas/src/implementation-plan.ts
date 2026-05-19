import { z } from 'zod';
import { FEATURE_SLUG_PATTERN } from './feature-spec.js';

const orderField = z.number().int().min(1);
const pathField = z.string().min(1);
const rationaleField = z.string().min(10);

export const PlanCreateOperationSchema = z
  .object({
    order: orderField,
    path: pathField,
    operation: z.literal('create'),
    rationale: rationaleField,
    full_content: z.string().min(1),
  })
  .strict();
export type PlanCreateOperation = z.infer<typeof PlanCreateOperationSchema>;

export const PlanModifyOperationSchema = z
  .object({
    order: orderField,
    path: pathField,
    operation: z.literal('modify'),
    rationale: rationaleField,
    diff: z.string().min(1).optional(),
    full_content: z.string().min(1).optional(),
  })
  .strict();
export type PlanModifyOperation = z.infer<typeof PlanModifyOperationSchema>;

export const PlanDeleteOperationSchema = z
  .object({
    order: orderField,
    path: pathField,
    operation: z.literal('delete'),
    rationale: rationaleField,
  })
  .strict();
export type PlanDeleteOperation = z.infer<typeof PlanDeleteOperationSchema>;

export const PlanOperationSchema = z.discriminatedUnion('operation', [
  PlanCreateOperationSchema,
  PlanModifyOperationSchema,
  PlanDeleteOperationSchema,
]);
export type PlanOperation = z.infer<typeof PlanOperationSchema>;

export const PlanTestFileSchema = z.object({
  path: pathField,
  content: z.string().min(1),
});
export type PlanTestFile = z.infer<typeof PlanTestFileSchema>;

export const ImplementationPlanSchema = z
  .object({
    feature_slug: z.string().regex(FEATURE_SLUG_PATTERN, {
      message:
        'feature_slug must be url-safe kebab-case: lowercase letters, digits, and dashes only, starting with a letter or digit',
    }),
    operations: z.array(PlanOperationSchema).min(1),
    tests_to_add: z.array(PlanTestFileSchema),
  })
  .superRefine((plan, ctx) => {
    plan.operations.forEach((op, index) => {
      if (op.operation === 'modify' && op.diff === undefined && op.full_content === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['operations', index],
          message: 'modify operations must include either a diff or full_content',
        });
      }
    });
  });
export type ImplementationPlan = z.infer<typeof ImplementationPlanSchema>;
