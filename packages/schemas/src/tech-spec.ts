import { z } from 'zod';
import { StackComponentSchema, StackDecisionSourceSchema } from './stack-recommendation.js';

export const TechSpecInferenceSchema = z.object({
  inferred: z.literal(true),
  inferred_fields: z.array(z.string()).min(1),
  notes: z.string().optional(),
});

export type TechSpecInference = z.infer<typeof TechSpecInferenceSchema>;

export const TechSpecStackSchema = z.object({
  label: z.string().min(1),
  source: StackDecisionSourceSchema,
  components: z.array(StackComponentSchema).min(1),
  tradeoffs: z.array(z.string()),
  validation_warnings: z.array(z.string()),
});
export type TechSpecStack = z.infer<typeof TechSpecStackSchema>;

export const TechSpecSchema = z.object({
  version: z.literal(1),

  project: z.object({
    name: z.string().min(1),
    type: z.string(),
    description: z.string(),
  }),

  context: z.object({
    primary_users: z.string(),
    expected_scale: z.string(),
    auth_requirements: z.string(),
    data_persistence: z.string(),
  }),

  stack: TechSpecStackSchema,

  rationale: z.string().min(50),

  inference: TechSpecInferenceSchema.optional(),
});

export type TechSpec = z.infer<typeof TechSpecSchema>;
