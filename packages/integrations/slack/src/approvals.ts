import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SpexError } from '@spex/core';

const APPROVAL_DIR_RELPATH = '.ai/scratch/approvals';
export const DEFAULT_APPROVAL_TIMEOUT_HOURS = 24;

export class SlackApprovalError extends SpexError {}

/**
 * Multi-approver decision strategy.
 *
 * - `any_of`: the first approver's decision wins (single approval needed).
 * - `all_of`: every listed approver must approve; any reject decides reject.
 * - `quorum`: at least `quorum` approvers must approve (configured separately).
 */
export type ApprovalMode = 'any_of' | 'all_of' | 'quorum';

export interface ApprovalConfig {
  /** Slack user IDs allowed to approve / reject. */
  approvers: readonly string[];
  /** Strategy for combining individual decisions. Default `any_of`. */
  mode: ApprovalMode;
  /** Quorum count when `mode === 'quorum'`. Ignored otherwise. */
  quorum?: number;
  /** Approval expiry. Default {@link DEFAULT_APPROVAL_TIMEOUT_HOURS}. */
  timeoutHours?: number;
}

export type ApprovalKind = 'spec_generated' | 'fix_proposed' | 'implementation_plan';

/**
 * The frozen workflow payload SPEX writes to disk when it posts an approval
 * card to Slack. Whoever resumes the workflow rebuilds the in-flight state
 * from this blob — keep it self-contained.
 */
export interface ApprovalWorkflowSnapshot {
  kind: ApprovalKind;
  /** Title of the thing being approved (mirrors the Slack message header). */
  title: string;
  /**
   * Free-form payload the workflow handler reads. SPEX does not interpret
   * the contents — different approval kinds carry different shapes (a fix
   * proposal vs a feature spec). The handler casts when resuming.
   */
  payload: Record<string, unknown>;
}

export interface DecisionEntry {
  /** Slack user id that pressed Approve / Reject. */
  userId: string;
  /** Approve / Reject. */
  decision: 'approve' | 'reject';
  /** ISO-8601 timestamp the decision was recorded. */
  at: string;
}

export interface ApprovalRecord {
  /** Storage schema version. */
  v: 1;
  /** Stable identifier. Set as the `value` on every Slack button. */
  correlationId: string;
  /** ISO-8601 timestamp the record was created. */
  createdAt: string;
  /** ISO-8601 timestamp after which the approval is treated as `expired`. */
  expiresAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  /** When status !== 'pending', this is the ISO-8601 finalisation timestamp. */
  finalisedAt?: string;
  config: ApprovalConfig;
  workflow: ApprovalWorkflowSnapshot;
  /**
   * Slack message coordinates so the receiver can update / thread on the same
   * post when a decision lands.
   */
  slack: { channelId: string; ts: string };
  /** Audit trail — append-only list of every decision Slack delivered. */
  decisions: DecisionEntry[];
}

export interface ApprovalStoreOptions {
  /** Project directory. The store lives under `<projectDir>/.ai/scratch/approvals/`. */
  projectDir: string;
  /** Override "now" for tests. Defaults to `new Date()`. */
  now?: () => Date;
}

function nowFn(options: ApprovalStoreOptions): () => Date {
  return options.now ?? (() => new Date());
}

function correlationIdFromBytes(): string {
  return `spex-approval-${randomBytes(12).toString('hex')}`;
}

function recordPath(correlationId: string, options: ApprovalStoreOptions): string {
  // Correlation ids come from this module's randomBytes-derived alphabet, so
  // they cannot contain path separators — safe to interpolate. We still
  // narrow the alphabet with a sanity check.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(correlationId)) {
    throw new SlackApprovalError(`Refusing to use invalid correlation id: ${correlationId}`);
  }
  return join(options.projectDir, APPROVAL_DIR_RELPATH, `${correlationId}.json`);
}

export interface CreateApprovalArgs {
  kind: ApprovalKind;
  title: string;
  payload: Record<string, unknown>;
  config: ApprovalConfig;
  slack: { channelId: string; ts: string };
}

/**
 * Create a new pending approval record. The correlation id this returns must
 * be set as the `value` of every Slack button on the approval card, so the
 * receiver can find the record again when the user clicks.
 */
export async function createPendingApproval(
  args: CreateApprovalArgs,
  options: ApprovalStoreOptions,
): Promise<ApprovalRecord> {
  const now = nowFn(options)();
  const timeoutHours = args.config.timeoutHours ?? DEFAULT_APPROVAL_TIMEOUT_HOURS;
  const expiresAt = new Date(now.getTime() + timeoutHours * 60 * 60 * 1000);
  const record: ApprovalRecord = {
    v: 1,
    correlationId: correlationIdFromBytes(),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'pending',
    config: args.config,
    workflow: { kind: args.kind, title: args.title, payload: args.payload },
    slack: args.slack,
    decisions: [],
  };
  const path = recordPath(record.correlationId, options);
  await mkdir(join(options.projectDir, APPROVAL_DIR_RELPATH), { recursive: true });
  await writeFile(path, JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 });
  return record;
}

/**
 * Load an approval record by correlation id. Returns `null` when no record
 * exists; throws when the file is unreadable or malformed (those indicate a
 * bug or a corrupted store and the caller should NOT silently treat them as
 * "no record").
 */
export async function loadApproval(
  correlationId: string,
  options: ApprovalStoreOptions,
): Promise<ApprovalRecord | null> {
  let raw: string;
  try {
    raw = await readFile(recordPath(correlationId, options), 'utf8');
  } catch (cause) {
    if (
      cause instanceof Error &&
      'code' in cause &&
      (cause as { code?: unknown }).code === 'ENOENT'
    ) {
      return null;
    }
    throw new SlackApprovalError(
      `Failed to read approval ${correlationId}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  try {
    return JSON.parse(raw) as ApprovalRecord;
  } catch (cause) {
    throw new SlackApprovalError(
      `Failed to parse approval ${correlationId}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

async function persist(record: ApprovalRecord, options: ApprovalStoreOptions): Promise<void> {
  const path = recordPath(record.correlationId, options);
  await writeFile(path, JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 });
}

/**
 * Compute the outcome of an approval given its current decision log + config.
 * Pure function — does not write to disk. Used by both `recordDecision` and
 * tests/inspection paths.
 */
export function computeApprovalOutcome(record: ApprovalRecord): ApprovalRecord['status'] {
  // Already finalised → never rewind.
  if (record.status !== 'pending') return record.status;

  const { mode } = record.config;
  const decisions = record.decisions;
  const approvedBy = new Set(
    decisions.filter((d) => d.decision === 'approve').map((d) => d.userId),
  );
  const rejectedBy = new Set(decisions.filter((d) => d.decision === 'reject').map((d) => d.userId));

  // A single reject is final under any_of and all_of. Under quorum, reject is
  // final once the remaining approvers cannot satisfy quorum even unanimously.
  if (mode === 'any_of') {
    if (decisions.length > 0) {
      // First-mover wins.
      return decisions[0]?.decision === 'approve' ? 'approved' : 'rejected';
    }
    return 'pending';
  }
  if (mode === 'all_of') {
    if (rejectedBy.size > 0) return 'rejected';
    const allApproved = record.config.approvers.every((id) => approvedBy.has(id));
    return allApproved ? 'approved' : 'pending';
  }
  if (mode === 'quorum') {
    const quorum = record.config.quorum ?? Math.ceil(record.config.approvers.length / 2);
    if (approvedBy.size >= quorum) return 'approved';
    const remaining = record.config.approvers.filter(
      (id) => !approvedBy.has(id) && !rejectedBy.has(id),
    );
    if (approvedBy.size + remaining.length < quorum) {
      return 'rejected';
    }
    return 'pending';
  }
  return 'pending';
}

export type RecordDecisionResult =
  | { kind: 'recorded'; record: ApprovalRecord }
  | { kind: 'expired'; record: ApprovalRecord }
  | { kind: 'already_finalised'; record: ApprovalRecord }
  | { kind: 'not_approver'; record: ApprovalRecord; userId: string }
  | { kind: 'duplicate'; record: ApprovalRecord; userId: string };

/**
 * Append a decision to an approval, recompute the outcome, persist the
 * record, and return what happened.
 *
 * Rejections by non-approvers, double-clicks by the same approver, and
 * decisions on already-finalised / expired approvals are all rejected
 * without mutating the audit log — they surface as discriminated result
 * variants the caller can handle (typically: respond ephemerally to the
 * Slack user with the reason).
 */
export async function recordDecision(args: {
  correlationId: string;
  userId: string;
  decision: 'approve' | 'reject';
  options: ApprovalStoreOptions;
}): Promise<RecordDecisionResult> {
  const record = await loadApproval(args.correlationId, args.options);
  if (record === null) {
    throw new SlackApprovalError(`No pending approval with correlation id ${args.correlationId}`);
  }
  const now = nowFn(args.options)();
  // Expire if past the timeout — done lazily so a missed cron doesn't leave
  // stale "pending" approvals; the first decision attempt finalises them.
  if (record.status === 'pending' && now.getTime() > Date.parse(record.expiresAt)) {
    record.status = 'expired';
    record.finalisedAt = now.toISOString();
    await persist(record, args.options);
    return { kind: 'expired', record };
  }
  if (record.status !== 'pending') {
    return { kind: 'already_finalised', record };
  }
  if (!record.config.approvers.includes(args.userId)) {
    return { kind: 'not_approver', record, userId: args.userId };
  }
  if (record.decisions.some((d) => d.userId === args.userId)) {
    return { kind: 'duplicate', record, userId: args.userId };
  }
  record.decisions.push({
    userId: args.userId,
    decision: args.decision,
    at: now.toISOString(),
  });
  const outcome = computeApprovalOutcome(record);
  if (outcome !== 'pending') {
    record.status = outcome;
    record.finalisedAt = now.toISOString();
  }
  await persist(record, args.options);
  return { kind: 'recorded', record };
}

/**
 * Walk every approval record on disk and mark expired ones (without changing
 * non-pending records). Intended for a periodic cleanup cron. Returns the
 * list of records that were freshly expired by this call.
 */
export async function expirePendingApprovals(
  options: ApprovalStoreOptions,
): Promise<ApprovalRecord[]> {
  const dir = join(options.projectDir, APPROVAL_DIR_RELPATH);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (cause) {
    if (
      cause instanceof Error &&
      'code' in cause &&
      (cause as { code?: unknown }).code === 'ENOENT'
    ) {
      return [];
    }
    throw cause;
  }
  const now = nowFn(options)();
  const expired: ApprovalRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const correlationId = entry.slice(0, -'.json'.length);
    const record = await loadApproval(correlationId, options);
    if (record === null || record.status !== 'pending') continue;
    if (now.getTime() <= Date.parse(record.expiresAt)) continue;
    record.status = 'expired';
    record.finalisedAt = now.toISOString();
    await persist(record, options);
    expired.push(record);
  }
  return expired;
}

/**
 * Delete an approval record from disk. Idempotent. Used after the workflow
 * resumes successfully and the approval no longer needs to be queryable.
 */
export async function deleteApproval(
  correlationId: string,
  options: ApprovalStoreOptions,
): Promise<boolean> {
  try {
    await unlink(recordPath(correlationId, options));
    return true;
  } catch (cause) {
    if (
      cause instanceof Error &&
      'code' in cause &&
      (cause as { code?: unknown }).code === 'ENOENT'
    ) {
      return false;
    }
    throw cause;
  }
}

/**
 * List every approval currently on disk, optionally filtered by status. The
 * `/spex status` command uses this to surface what is waiting on approval.
 */
export async function listApprovals(
  options: ApprovalStoreOptions & { statusFilter?: ApprovalRecord['status'] },
): Promise<ApprovalRecord[]> {
  const dir = join(options.projectDir, APPROVAL_DIR_RELPATH);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (cause) {
    if (
      cause instanceof Error &&
      'code' in cause &&
      (cause as { code?: unknown }).code === 'ENOENT'
    ) {
      return [];
    }
    throw cause;
  }
  const out: ApprovalRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const correlationId = entry.slice(0, -'.json'.length);
    const record = await loadApproval(correlationId, options);
    if (record === null) continue;
    if (options.statusFilter !== undefined && record.status !== options.statusFilter) continue;
    out.push(record);
  }
  // Sort oldest-first so /spex status reads chronologically.
  out.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return out;
}
