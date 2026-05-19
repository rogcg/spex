import { z } from 'zod';

export const TechSpecInferenceSchema = z.object({
  inferred: z.literal(true),
  inferred_fields: z.array(z.string()).min(1),
  notes: z.string().optional(),
});

export type TechSpecInference = z.infer<typeof TechSpecInferenceSchema>;

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

  stack: z.object({
    language: z.literal('typescript'),
    frontend: z.object({
      framework: z.literal('nextjs'),
      version: z.string(),
      styling: z.string(),
      app_router: z.boolean(),
    }),
  }),

  scaffolding_plan: z.object({
    commands: z.array(z.string()).min(1),
    post_install_files: z.array(z.string()).optional(),
  }),

  rationale: z.string().min(50),

  inference: TechSpecInferenceSchema.optional(),
});

export type TechSpec = z.infer<typeof TechSpecSchema>;
