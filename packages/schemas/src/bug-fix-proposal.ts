import { z } from 'zod';

/** Option ids are o1, o2, o3 — the index of the option in presentation order. */
export const FIX_OPTION_ID_PATTERN = /^o[1-9][0-9]*$/;

export const FixScopeSchema = z.enum(['minimal', 'moderate', 'extensive']);
export type FixScope = z.infer<typeof FixScopeSchema>;

export const FixRiskSchema = z.enum(['low', 'medium', 'high']);
export type FixRisk = z.infer<typeof FixRiskSchema>;

export const FixOptionSchema = z.object({
  id: z.string().regex(FIX_OPTION_ID_PATTERN, {
    message: 'id must follow the o1/o2/... pattern (lowercase o + positive integer)',
  }),
  label: z.string().min(1, 'label is required'),
  scope: FixScopeSchema,
  risk: FixRiskSchema,
  rationale: z.string().min(20, 'rationale must explain why this option is sensible'),
  diff: z
    .string()
    .min(1, 'diff must be a non-empty unified diff against the supplied file contents'),
});
export type FixOption = z.infer<typeof FixOptionSchema>;

export const FixProposalSchema = z
  .object({
    options: z
      .array(FixOptionSchema)
      .min(1, 'at least 1 fix option is required')
      .max(3, 'at most 3 fix options may be proposed'),
    /**
     * id of the option the LLM recommends. Must match one of the `options[].id`
     * values — enforced via `superRefine` below.
     */
    recommended: z.string().regex(FIX_OPTION_ID_PATTERN),
    recommendationRationale: z
      .string()
      .min(20, 'recommendationRationale must justify the recommended choice'),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    value.options.forEach((opt, index) => {
      if (ids.has(opt.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options', index, 'id'],
          message: `duplicate option id: ${opt.id}`,
        });
      }
      ids.add(opt.id);
    });
    if (!ids.has(value.recommended)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recommended'],
        message: `recommended id "${value.recommended}" does not match any option id`,
      });
    }
  });
export type FixProposal = z.infer<typeof FixProposalSchema>;
