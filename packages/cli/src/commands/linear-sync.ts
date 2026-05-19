import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { InvalidAiConfigError, loadAiConfig } from '@spex/core';
import {
  type PrEventKind,
  createLinearMcpClient,
  extractLinearId,
  syncPrEventToLinear,
} from '@spex/integrations-linear';
import { STRINGS } from '../strings.js';

export interface LinearSyncCommandOptions {
  /** Event kind. Either explicit, or derived from GitHub event payload. */
  event?: string;
  /** Linear issue identifier. When omitted, extracted from PR body / branch. */
  linearId?: string;
  /** Path to a GitHub `pull_request` event payload JSON. */
  eventPath?: string;
  /** PR number. Used by the closed-without-merge comment. */
  prNumber?: number;
  /** PR URL. Used by the closed-without-merge comment. */
  prUrl?: string;
  /** Branch the PR was opened from. Used for Linear-id fallback. */
  branch?: string;
  /** PR body. Used for Linear-id extraction (prefers `Closes <ID>`). */
  prBody?: string;
  /** When true, log the planned mutation but don't call Linear. */
  dryRun?: boolean;
}

const VALID_EVENTS = ['opened', 'merged', 'closed_unmerged'] as const;

export async function runLinearSyncCommand(options: LinearSyncCommandOptions = {}): Promise<void> {
  const projectDir = resolve(process.cwd());

  let config: Awaited<ReturnType<typeof loadAiConfig>>;
  try {
    config = await loadAiConfig({ projectDir });
  } catch (cause) {
    if (cause instanceof InvalidAiConfigError) {
      console.error(STRINGS.linearSyncCommand.invalidConfig(cause.issues));
      process.exitCode = 1;
      return;
    }
    throw cause;
  }
  const linearConfig = config?.integrations?.linear;
  if (!linearConfig) {
    console.error(STRINGS.linearSyncCommand.integrationNotConfigured);
    process.exitCode = 1;
    return;
  }

  // Resolve event source: explicit --event takes priority; otherwise parse the
  // GitHub pull_request payload at --event-path.
  let eventKind: PrEventKind | null = null;
  let prNumber: number | null = options.prNumber ?? null;
  let prUrl: string | null = options.prUrl ?? null;
  let prBody: string | null = options.prBody ?? null;
  let branch: string | null = options.branch ?? null;

  if (options.event !== undefined) {
    if (!isPrEventKind(options.event)) {
      console.error(STRINGS.linearSyncCommand.invalidEvent(options.event));
      process.exitCode = 1;
      return;
    }
    eventKind = options.event;
  } else if (options.eventPath !== undefined) {
    try {
      const payload = await readGithubPullRequestEvent(options.eventPath);
      eventKind = payload.eventKind;
      prNumber = prNumber ?? payload.prNumber;
      prUrl = prUrl ?? payload.prUrl;
      prBody = prBody ?? payload.prBody;
      branch = branch ?? payload.branch;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(STRINGS.linearSyncCommand.eventPayloadFailed(options.eventPath, message));
      process.exitCode = 1;
      return;
    }
  } else {
    console.error(STRINGS.linearSyncCommand.missingEvent);
    process.exitCode = 1;
    return;
  }

  if (prNumber === null || prUrl === null) {
    console.error(STRINGS.linearSyncCommand.missingPrFields);
    process.exitCode = 1;
    return;
  }

  const linearId =
    options.linearId ??
    extractLinearId({
      ...(prBody !== null ? { prBody } : {}),
      ...(branch !== null ? { branch } : {}),
    });
  if (!linearId) {
    console.log(STRINGS.linearSyncCommand.noLinearIssueDetected);
    return;
  }

  if ((process.env.LINEAR_API_KEY ?? '').length === 0) {
    console.error(STRINGS.linearSyncCommand.missingApiKey);
    process.exitCode = 1;
    return;
  }

  if (options.dryRun === true) {
    console.log(
      STRINGS.linearSyncCommand.dryRun({
        event: eventKind,
        linearId,
        prNumber,
        prUrl,
      }),
    );
    return;
  }

  console.log(STRINGS.linearSyncCommand.syncing(linearId, eventKind));
  const linear = await createLinearMcpClient();
  try {
    const result = await syncPrEventToLinear({
      client: linear,
      linearId,
      event: { kind: eventKind, prNumber, prUrl },
      statusMapping: linearConfig.status_mapping,
      commentOnUnmergedClose: linearConfig.comment_on_unmerged_close,
    });
    console.log(STRINGS.linearSyncCommand.synced({ linearId, status: result.issue.status.name }));
    if (result.comment !== null) {
      console.log(STRINGS.linearSyncCommand.commentPosted(result.comment.url));
    }
  } catch (cause) {
    console.error(
      STRINGS.linearSyncCommand.syncFailed(cause instanceof Error ? cause.message : String(cause)),
    );
    process.exitCode = 1;
  } finally {
    await linear.close();
  }
}

function isPrEventKind(value: string): value is PrEventKind {
  return (VALID_EVENTS as readonly string[]).includes(value);
}

interface ParsedPullRequestEvent {
  eventKind: PrEventKind;
  prNumber: number;
  prUrl: string;
  prBody: string;
  branch: string;
}

/**
 * Parse a GitHub Actions `pull_request` event payload. Maps the GitHub
 * action+merged combo to our internal `PrEventKind`:
 *   - action=opened|reopened       → 'opened'
 *   - action=closed, merged=true   → 'merged'
 *   - action=closed, merged=false  → 'closed_unmerged'
 */
export async function readGithubPullRequestEvent(path: string): Promise<ParsedPullRequestEvent> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as {
    action?: string;
    pull_request?: {
      number?: number;
      html_url?: string;
      body?: string | null;
      merged?: boolean;
      head?: { ref?: string };
    };
  };
  const action = parsed.action;
  const pr = parsed.pull_request;
  if (!pr) throw new Error('payload has no `pull_request` field');
  if (typeof pr.number !== 'number') throw new Error('payload `pull_request.number` is missing');
  if (typeof pr.html_url !== 'string')
    throw new Error('payload `pull_request.html_url` is missing');

  let eventKind: PrEventKind;
  if (action === 'opened' || action === 'reopened') {
    eventKind = 'opened';
  } else if (action === 'closed') {
    eventKind = pr.merged === true ? 'merged' : 'closed_unmerged';
  } else {
    throw new Error(`unsupported pull_request action: ${action}`);
  }

  return {
    eventKind,
    prNumber: pr.number,
    prUrl: pr.html_url,
    prBody: pr.body ?? '',
    branch: pr.head?.ref ?? '',
  };
}
