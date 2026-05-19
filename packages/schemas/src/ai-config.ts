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

export const PostHogIssueSeveritySchema = z.enum(['critical', 'error', 'warning', 'info', 'debug']);

export const PostHogAutoFixConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    /**
     * Severity allow-list. Defaults to `['critical']` — events whose severity
     * is unclassified by PostHog also pass when this list contains
     * `'critical'`, since unclassified is conservatively treated as critical.
     */
    severity: z.array(PostHogIssueSeveritySchema).min(1).default(['critical']),
    /**
     * Minimum occurrence count needed before SPEX triggers a fix workflow.
     * Defaults to 5 — high enough to skip one-off transient errors, low
     * enough to react quickly when an issue is genuinely re-firing.
     */
    min_occurrences: z.number().int().min(1).default(5),
  })
  .strict()
  .default({
    enabled: false,
    severity: ['critical'],
    min_occurrences: 5,
  });

export const PostHogIntegrationConfigSchema = z
  .object({
    /**
     * Used by `spex posthog-webhook` to decide whether to auto-trigger a fix
     * on incoming PostHog error-tracking events.
     */
    auto_fix: PostHogAutoFixConfigSchema,
  })
  .strict();

export const IntegrationsConfigSchema = z
  .object({
    github: GitHubIntegrationConfigSchema.optional(),
    linear: LinearIntegrationConfigSchema.optional(),
    posthog: PostHogIntegrationConfigSchema.optional(),
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
export type PostHogIntegrationConfig = z.infer<typeof PostHogIntegrationConfigSchema>;
export type PostHogAutoFixConfig = z.infer<typeof PostHogAutoFixConfigSchema>;
export type PostHogIssueSeverity = z.infer<typeof PostHogIssueSeveritySchema>;
export type IntegrationsConfig = z.infer<typeof IntegrationsConfigSchema>;
export type AiConfig = z.infer<typeof AiConfigSchema>;
