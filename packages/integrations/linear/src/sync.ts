import type { LinearStatusMapping } from '@spex/schemas';
import { addLinearComment, updateLinearIssueStatus } from './operations.js';
import type { LinearComment, LinearIssue, LinearMcpClient } from './types.js';

const LINEAR_ID_PATTERN = /\b([A-Z][A-Z0-9_]*-\d+)\b/;
const CLOSES_PATTERN = /Closes\s+\[?([A-Z][A-Z0-9_]*-\d+)\]?/i;

/**
 * Extract a Linear issue identifier from PR body text. Prefers a
 * `Closes <ID>` reference (case-insensitive), falls back to the first
 * bare identifier found. Returns `null` when no candidate exists.
 */
export function extractLinearIdFromPrBody(body: string): string | null {
  const closes = body.match(CLOSES_PATTERN);
  if (closes?.[1]) return closes[1];
  const bare = body.match(LINEAR_ID_PATTERN);
  return bare?.[1] ?? null;
}

/**
 * Extract a Linear issue identifier from a git branch name. Branches are
 * typically lowercased (e.g. `admin/spx-47-...`); we re-uppercase the team
 * prefix so the returned value matches Linear's canonical identifier shape.
 */
export function extractLinearIdFromBranch(branch: string): string | null {
  const match = branch.toUpperCase().match(LINEAR_ID_PATTERN);
  return match?.[1] ?? null;
}

export interface ExtractLinearIdOptions {
  prBody?: string | null;
  branch?: string | null;
}

/** Try PR body first, then branch name. */
export function extractLinearId(options: ExtractLinearIdOptions): string | null {
  if (options.prBody) {
    const fromBody = extractLinearIdFromPrBody(options.prBody);
    if (fromBody) return fromBody;
  }
  if (options.branch) {
    return extractLinearIdFromBranch(options.branch);
  }
  return null;
}

export type PrEventKind = 'opened' | 'merged' | 'closed_unmerged';

export interface PrEvent {
  kind: PrEventKind;
  /** GitHub PR number — used in the unmerged-close comment for traceability. */
  prNumber: number;
  /** Full PR URL — used in the unmerged-close comment. */
  prUrl: string;
}

export interface SyncPrEventResult {
  issue: LinearIssue;
  comment: LinearComment | null;
}

export interface SyncPrEventOptions {
  client: LinearMcpClient;
  /** Linear issue identifier (e.g. `SPX-47`) the PR is linked to. */
  linearId: string;
  event: PrEvent;
  statusMapping: LinearStatusMapping;
  /**
   * When true, an unmerged-close event also posts a comment to the Linear
   * issue. Defaults to `true` for `closed_unmerged`, ignored otherwise.
   */
  commentOnUnmergedClose?: boolean;
}

/**
 * Map a GitHub PR lifecycle event to the corresponding Linear status update
 * (and, for unmerged closes, an explanatory comment). Returns the updated
 * Linear issue plus the comment (or `null` if none was posted).
 */
export async function syncPrEventToLinear(options: SyncPrEventOptions): Promise<SyncPrEventResult> {
  const targetStatus = resolveTargetStatus(options.event.kind, options.statusMapping);
  const issue = await updateLinearIssueStatus({
    client: options.client,
    id: options.linearId,
    status: targetStatus,
  });

  let comment: LinearComment | null = null;
  if (options.event.kind === 'closed_unmerged' && options.commentOnUnmergedClose !== false) {
    comment = await addLinearComment({
      client: options.client,
      issueId: options.linearId,
      body: buildUnmergedCloseCommentBody(options.event),
    });
  }
  return { issue, comment };
}

function resolveTargetStatus(kind: PrEventKind, mapping: LinearStatusMapping): string {
  switch (kind) {
    case 'opened':
      return mapping.in_review;
    case 'merged':
      return mapping.done;
    case 'closed_unmerged':
      return mapping.todo;
  }
}

function buildUnmergedCloseCommentBody(event: PrEvent): string {
  return `SPEX: linked PR [#${event.prNumber}](${event.prUrl}) was closed without merging. Returning this issue to the backlog for re-triage.`;
}
