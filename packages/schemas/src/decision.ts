import { z } from 'zod';

export const DECISION_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export const DecisionConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type DecisionConfidence = z.infer<typeof DecisionConfidenceSchema>;

export const DecisionStatusSchema = z.enum([
  'pending',
  'presented',
  'accepted',
  'rejected',
  'modified',
]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const DecisionAlternativeSchema = z.object({
  label: z.string().min(1),
  tradeoffs: z.string().min(1),
});
export type DecisionAlternative = z.infer<typeof DecisionAlternativeSchema>;

export const DecisionSchema = z.object({
  id: z.string().regex(DECISION_ID_PATTERN, {
    message: 'decision.id must be lowercase letters, digits, and dashes; starts with a letter',
  }),
  order: z.number().int().min(1),
  category: z.string().min(1),
  question: z.string().min(1),
  proposal: z.string().min(1),
  rationale: z.string().min(1),
  techSpecPath: z.string().min(1),
  confidence: DecisionConfidenceSchema,
  alternatives: z.array(DecisionAlternativeSchema).optional(),
  status: DecisionStatusSchema,
  resolvedValue: z.string().optional(),
  userNote: z.string().optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const DecisionListSchema = z.object({
  decisions: z.array(DecisionSchema).min(1),
});
export type DecisionList = z.infer<typeof DecisionListSchema>;

export const ProposalStateSchema = z.object({
  version: z.literal(1),
  pausedAt: z.string().min(1),
  projectName: z.string().min(1),
  decisions: z.array(DecisionSchema),
  currentIndex: z.number().int().min(0),
});
export type ProposalState = z.infer<typeof ProposalStateSchema>;
