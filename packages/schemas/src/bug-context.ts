import { z } from 'zod';

export const BugErrorInfoSchema = z
  .object({
    message: z.string().optional(),
    stack: z.string().optional(),
    firstOccurrence: z.string().optional(),
  })
  .refine(
    (value) =>
      value.message !== undefined ||
      value.stack !== undefined ||
      value.firstOccurrence !== undefined,
    { message: 'error must include at least one of message, stack, firstOccurrence' },
  );
export type BugErrorInfo = z.infer<typeof BugErrorInfoSchema>;

export const RecentCommitSchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{7,40}$/i, 'sha must be a 7-40 character hex commit identifier'),
  message: z.string(),
  date: z.string().min(1),
});
export type RecentCommit = z.infer<typeof RecentCommitSchema>;

export const ErrorReferenceSourceSchema = z.enum(['manual', 'posthog', 'github']);
export type ErrorReferenceSource = z.infer<typeof ErrorReferenceSourceSchema>;

export const ErrorReferenceSchema = z.object({
  source: ErrorReferenceSourceSchema,
  id: z.string().min(1),
});
export type ErrorReference = z.infer<typeof ErrorReferenceSchema>;

export const BugContextSchema = z.object({
  description: z.string().min(1, 'description is required'),
  error: BugErrorInfoSchema.optional(),
  affectedFiles: z.array(z.string().min(1)),
  recentCommits: z.array(RecentCommitSchema),
  /**
   * Path → file content. Stored separately from `affectedFiles` so consumers
   * that only need the path list (e.g. a CLI summary) don't pay for content
   * marshalling.
   */
  affectedFileContents: z.record(z.string(), z.string()).optional(),
  /**
   * Where the bug report came from. `manual` is the only source supported;
   * `posthog` / `github` are placeholders.
   */
  errorReference: ErrorReferenceSchema.optional(),
});
export type BugContext = z.infer<typeof BugContextSchema>;
