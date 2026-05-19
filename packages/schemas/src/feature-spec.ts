import { z } from 'zod';

export const FEATURE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const FeatureFileOperationSchema = z.enum(['create', 'modify', 'delete']);
export type FeatureFileOperation = z.infer<typeof FeatureFileOperationSchema>;

export const FeatureFileChangeSchema = z.object({
  path: z.string().min(1),
  operation: FeatureFileOperationSchema,
});
export type FeatureFileChange = z.infer<typeof FeatureFileChangeSchema>;

export const FeatureSpecSchema = z.object({
  version: z.literal(1),

  feature: z.object({
    slug: z.string().regex(FEATURE_SLUG_PATTERN, {
      message:
        'feature.slug must be url-safe kebab-case: lowercase letters, digits, and dashes only, starting with a letter or digit',
    }),
    title: z.string().min(1),
    description: z.string().min(1),
  }),

  scope: z.object({
    in: z.array(z.string().min(1)).min(1),
    out: z.array(z.string().min(1)),
  }),

  technical_approach: z.string().min(20),

  files_affected: z.array(FeatureFileChangeSchema).min(1),

  test_cases: z.array(z.string().min(1)).min(1),

  rationale: z.string().min(20),
});

export type FeatureSpec = z.infer<typeof FeatureSpecSchema>;
