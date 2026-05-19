import { z } from 'zod';

export const RootCauseEvidenceItemSchema = z.object({
  file: z.string().min(1),
  /**
   * Line range citation. Accepts a single line ("42") or a range ("42-58").
   * Free-form to keep the LLM honest about partial / approximate ranges; the
   * downstream display can re-format.
   */
  lines: z.string().min(1),
  explanation: z.string().min(10, 'each evidence item needs a non-trivial explanation'),
});
export type RootCauseEvidenceItem = z.infer<typeof RootCauseEvidenceItemSchema>;

export const RootCauseAnalysisSchema = z
  .object({
    confirmed: z.boolean(),
    rootCause: z
      .string()
      .min(20, 'rootCause must explain the mechanism (confirmed) or the rejection (refuted)'),
    evidence: z.array(RootCauseEvidenceItemSchema).min(1, 'at least one evidence item is required'),
    /**
     * Required when `confirmed === false`. Should be an id-and-rationale string
     * like "h2 — server-side rendering of page param" so the caller can pick
     * up the next analysis step without re-prompting.
     */
    nextHypothesisToTest: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      !value.confirmed &&
      (value.nextHypothesisToTest === undefined || value.nextHypothesisToTest.trim().length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nextHypothesisToTest'],
        message:
          'nextHypothesisToTest is required when confirmed=false (refuted hypotheses must hand off)',
      });
    }
  });
export type RootCauseAnalysis = z.infer<typeof RootCauseAnalysisSchema>;
