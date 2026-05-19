import { z } from 'zod';

/**
 * Hypothesis identifiers are short and human-readable so the next step in the
 * pipeline (root-cause analyzer) can refer to them in commit messages and CLI
 * UI. Convention: `h1` is the highest-ranked, `h2` second, etc.
 */
export const HYPOTHESIS_ID_PATTERN = /^h[1-9][0-9]*$/;

export const HypothesisConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type HypothesisConfidence = z.infer<typeof HypothesisConfidenceSchema>;

export const HypothesisSchema = z.object({
  id: z.string().regex(HYPOTHESIS_ID_PATTERN, {
    message: 'id must follow the h1/h2/... pattern (lowercase h + positive integer)',
  }),
  description: z.string().min(20, 'description must explain the proposed root cause'),
  confidence: HypothesisConfidenceSchema,
  evidence: z
    .array(z.string().min(1))
    .min(1, 'at least one piece of specific evidence is required'),
  proposedDiagnostic: z.string().min(10, 'proposedDiagnostic must describe a concrete next step'),
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;

export const HypothesisListSchema = z
  .object({
    hypotheses: z
      .array(HypothesisSchema)
      .min(3, 'at least 3 hypotheses are required')
      .max(5, 'at most 5 hypotheses may be produced'),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    value.hypotheses.forEach((h, index) => {
      if (ids.has(h.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hypotheses', index, 'id'],
          message: `duplicate hypothesis id: ${h.id}`,
        });
      }
      ids.add(h.id);
    });
  });
export type HypothesisList = z.infer<typeof HypothesisListSchema>;
