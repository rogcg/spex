import { z } from 'zod';

export const ReviewModeSchema = z.enum(['single', 'split']);
export type ReviewMode = z.infer<typeof ReviewModeSchema>;

export const GitHubIntegrationConfigSchema = z
  .object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    auto_create_pr: z.boolean().default(false),
    pr_labels: z.array(z.string().min(1)).default(['spex-generated']),
    base_branch: z.string().min(1).default('main'),
    host: z.string().min(1).default('github.com'),
    review_mode: ReviewModeSchema.default('single'),
  })
  .strict();

export const IntegrationsConfigSchema = z
  .object({
    github: GitHubIntegrationConfigSchema.optional(),
  })
  .strict();

export const AiConfigSchema = z
  .object({
    integrations: IntegrationsConfigSchema.optional(),
  })
  .strict();

export type GitHubIntegrationConfig = z.infer<typeof GitHubIntegrationConfigSchema>;
export type IntegrationsConfig = z.infer<typeof IntegrationsConfigSchema>;
export type AiConfig = z.infer<typeof AiConfigSchema>;
