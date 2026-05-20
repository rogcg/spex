import { z } from 'zod';

export const StackConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type StackConfidence = z.infer<typeof StackConfidenceSchema>;

export const StackComponentSchema = z.object({
  role: z.string().min(1),
  choice: z.string().min(1),
  rationale: z.string().min(1),
});
export type StackComponent = z.infer<typeof StackComponentSchema>;

export const StackRecommendationSchema = z.object({
  rank: z.number().int().min(1),
  label: z.string().min(1),
  components: z.array(StackComponentSchema).min(1),
  tradeoffs: z.array(z.string().min(1)),
  confidence: StackConfidenceSchema,
  requirementsCovered: z.array(z.string()),
  requirementsUnaddressed: z.array(z.string()),
});
export type StackRecommendation = z.infer<typeof StackRecommendationSchema>;

export const StackRecommendationsSchema = z.object({
  recommendations: z.array(StackRecommendationSchema).min(1),
  unmappedRequirements: z.array(z.string()),
});
export type StackRecommendations = z.infer<typeof StackRecommendationsSchema>;

export const StackDecisionSourceSchema = z.enum(['recommended', 'user', 'brainstormed']);
export type StackDecisionSource = z.infer<typeof StackDecisionSourceSchema>;

export const StackDecisionSchema = z.object({
  label: z.string().min(1),
  components: z.array(StackComponentSchema).min(1),
  source: StackDecisionSourceSchema,
  rationale: z.string().min(1),
  tradeoffs: z.array(z.string()),
  validationWarnings: z.array(z.string()),
});
export type StackDecision = z.infer<typeof StackDecisionSchema>;
