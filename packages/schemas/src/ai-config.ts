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

export const LinearStatusMappingSchema = z
  .object({
    in_progress: z.string().min(1).default('In Progress'),
    in_review: z.string().min(1).default('In Review'),
    done: z.string().min(1).default('Done'),
    todo: z.string().min(1).default('Todo'),
  })
  .strict()
  .default({
    in_progress: 'In Progress',
    in_review: 'In Review',
    done: 'Done',
    todo: 'Todo',
  });

export const LinearIntegrationConfigSchema = z
  .object({
    /** Linear team key (e.g. `SPX`), used by `list_issues` filtering. */
    team: z.string().min(1),
    /** Drives `spex linear-sync` event → workflow-state-name resolution. */
    status_mapping: LinearStatusMappingSchema,
    /**
     * When true, `spex linear-sync` will comment on the Linear issue when a
     * PR closes without merging (to record the rejection rationale).
     */
    comment_on_unmerged_close: z.boolean().default(true),
  })
  .strict();

export const IntegrationsConfigSchema = z
  .object({
    github: GitHubIntegrationConfigSchema.optional(),
    linear: LinearIntegrationConfigSchema.optional(),
  })
  .strict();

export const AiConfigSchema = z
  .object({
    integrations: IntegrationsConfigSchema.optional(),
  })
  .strict();

export type GitHubIntegrationConfig = z.infer<typeof GitHubIntegrationConfigSchema>;
export type LinearStatusMapping = z.infer<typeof LinearStatusMappingSchema>;
export type LinearIntegrationConfig = z.infer<typeof LinearIntegrationConfigSchema>;
export type IntegrationsConfig = z.infer<typeof IntegrationsConfigSchema>;
export type AiConfig = z.infer<typeof AiConfigSchema>;
