import { z } from 'zod';

export const WORKFLOW_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;

export const ScratchWorkflowKindSchema = z.enum(['discovery', 'proposal', 'implementation', 'fix']);
export type ScratchWorkflowKind = z.infer<typeof ScratchWorkflowKindSchema>;

export const ScratchWorkflowStatusSchema = z.enum([
  'running',
  'paused',
  'completed',
  'abandoned',
  'crashed',
]);
export type ScratchWorkflowStatus = z.infer<typeof ScratchWorkflowStatusSchema>;

export const FileSnapshotSchema = z.object({
  path: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/, {
    message: 'hash must be a lowercase hex SHA-256 digest',
  }),
  size: z.number().int().nonnegative(),
  exists: z.boolean(),
});
export type FileSnapshot = z.infer<typeof FileSnapshotSchema>;

export const CheckpointSchema = z.object({
  name: z.string().min(1),
  createdAt: z.string().min(1),
  payload: z.unknown().optional(),
  fileSnapshots: z.array(FileSnapshotSchema).default([]),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const ScratchStateSchema = z.object({
  version: z.literal(1),
  workflowId: z.string().regex(WORKFLOW_ID_PATTERN, {
    message:
      'workflowId must be lowercase letters/digits/dashes/underscores (1-128 chars, starts alphanumeric)',
  }),
  kind: ScratchWorkflowKindSchema,
  status: ScratchWorkflowStatusSchema,
  description: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastActivityAt: z.string().min(1),
  pid: z.number().int().positive().optional(),
  hostname: z.string().optional(),
  payload: z.unknown().optional(),
});
export type ScratchState = z.infer<typeof ScratchStateSchema>;

export const ScratchLockSchema = z.object({
  version: z.literal(1),
  workflowId: z.string().regex(WORKFLOW_ID_PATTERN),
  pid: z.number().int().positive(),
  hostname: z.string().min(1),
  acquiredAt: z.string().min(1),
});
export type ScratchLock = z.infer<typeof ScratchLockSchema>;

export const ScratchSessionSchema = z.object({
  version: z.literal(1),
  activeWorkflowId: z.string().regex(WORKFLOW_ID_PATTERN).nullable(),
  updatedAt: z.string().min(1),
});
export type ScratchSession = z.infer<typeof ScratchSessionSchema>;

export const AuditEventTypeSchema = z.enum([
  'llm_call',
  'decision',
  'file_write',
  'file_read',
  'git_operation',
  'tool_invocation',
  'approval',
  'error',
  'state_transition',
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

export const AuditActorSchema = z.enum(['user', 'agent', 'system']);
export type AuditActor = z.infer<typeof AuditActorSchema>;

export const AuditEventSchema = z.object({
  timestamp: z.string().min(1),
  workflowId: z.string().regex(WORKFLOW_ID_PATTERN),
  type: AuditEventTypeSchema,
  actor: AuditActorSchema,
  payload: z.record(z.unknown()),
  correlationId: z.string().optional(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
