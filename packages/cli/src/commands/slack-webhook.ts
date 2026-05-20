import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { InvalidAiConfigError, loadAiConfig } from '@spex/core';
import {
  InvalidSlackWebhookPayloadError,
  type PermissionCheckResult,
  type SlackWebhookEvent,
  type SpexSlackCommand,
  checkSlashPermission,
  loadApproval,
  parseSlackWebhookPayload,
  parseSpexSlashCommand,
  recordDecision,
  verifySlackSignature,
} from '@spex/integrations-slack';
import { STRINGS } from '../strings.js';
import { runFixCommand } from './fix.js';
import { runImplementCommand } from './implement.js';
import { runReviewCommand } from './review.js';

export interface SlackWebhookCommandOptions {
  /** Path to a file containing the raw Slack request body. */
  payloadPath?: string;
  /** `X-Slack-Signature` header (`v0=…`). */
  signature?: string;
  /** `X-Slack-Request-Timestamp` header (unix seconds). */
  timestamp?: string;
  /** Override `SLACK_SIGNING_SECRET`. */
  secret?: string;
  /** Parse + verify but do not invoke the downstream SPEX flow. */
  dryRun?: boolean;
}

/**
 * Handle an incoming Slack webhook delivery. Mirrors the PostHog one-shot
 * webhook command shape: a delivery proxy (GitHub Action, Lambda, Cloud Run)
 * writes the raw body to disk and invokes this command with the headers.
 *
 * Three responsibilities:
 *   1. Verify the v0 HMAC signature against `SLACK_SIGNING_SECRET`.
 *   2. Parse the payload into one of: slash command / block_actions / unknown.
 *   3. Dispatch:
 *      - slash commands → `spex implement` / `spex review` / `/spex status`.
 *      - button clicks (block_actions) → record the approval decision.
 *
 * Always exits 0 on a clean skip — the delivery proxy must not retry.
 */
export async function runSlackWebhookCommand(
  options: SlackWebhookCommandOptions = {},
): Promise<void> {
  const projectDir = resolve(process.cwd());

  // Phase 1: load config. Slack integration block must be present.
  let config: Awaited<ReturnType<typeof loadAiConfig>>;
  try {
    config = await loadAiConfig({ projectDir });
  } catch (cause) {
    if (cause instanceof InvalidAiConfigError) {
      console.error(STRINGS.slackWebhookCommand.invalidConfig(cause.issues));
      process.exitCode = 1;
      return;
    }
    throw cause;
  }
  const slackConfig = config?.integrations?.slack;
  if (slackConfig === undefined) {
    console.error(STRINGS.slackWebhookCommand.integrationNotConfigured);
    process.exitCode = 1;
    return;
  }

  // Phase 2: read the payload body.
  if (options.payloadPath === undefined) {
    console.error(STRINGS.slackWebhookCommand.missingPayloadPath);
    process.exitCode = 1;
    return;
  }
  let rawBody: string;
  try {
    rawBody = await readFile(options.payloadPath, 'utf8');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(STRINGS.slackWebhookCommand.payloadReadFailed(options.payloadPath, message));
    process.exitCode = 1;
    return;
  }

  // Phase 3: signature verification (required when a signature/timestamp pair
  // is supplied, which it always is for real Slack deliveries).
  const signingSecret = options.secret ?? process.env.SLACK_SIGNING_SECRET;
  if (options.signature !== undefined) {
    if (signingSecret === undefined || signingSecret.length === 0) {
      console.error(STRINGS.slackWebhookCommand.missingSigningSecret);
      process.exitCode = 1;
      return;
    }
    if (options.timestamp === undefined) {
      console.error(STRINGS.slackWebhookCommand.missingSigningSecret);
      process.exitCode = 1;
      return;
    }
    const ok = verifySlackSignature({
      rawBody,
      signatureHeader: options.signature,
      timestampHeader: options.timestamp,
      signingSecret,
    });
    if (!ok) {
      console.error(STRINGS.slackWebhookCommand.signatureMismatch);
      process.exitCode = 1;
      return;
    }
    console.log(STRINGS.slackWebhookCommand.signatureVerified);
  }

  // Phase 4: parse the payload.
  let event: SlackWebhookEvent;
  try {
    event = parseSlackWebhookPayload(rawBody);
  } catch (cause) {
    if (cause instanceof InvalidSlackWebhookPayloadError) {
      console.error(STRINGS.slackWebhookCommand.invalidPayload(cause.message));
      process.exitCode = 1;
      return;
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(STRINGS.slackWebhookCommand.invalidPayload(message));
    process.exitCode = 1;
    return;
  }

  if (event.kind === 'unknown') {
    console.log(STRINGS.slackWebhookCommand.unknownEventReason(event.reason));
    return;
  }

  // Phase 5: dispatch.
  if (event.kind === 'slash_command') {
    const slashCommand = parseSpexSlashCommand(event.command);
    const permission = checkSlashPermission({
      command: slashCommand,
      config: slackConfig.slash_commands,
    });
    if (permission.kind !== 'allowed') {
      console.error(
        STRINGS.slackWebhookCommand.permissionDenied(describePermissionFailure(permission)),
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      STRINGS.slackWebhookCommand.dispatchSlashCommand(slashCommand.kind, slashCommand.userId),
    );
    if (options.dryRun === true) {
      console.log(STRINGS.slackWebhookCommand.dryRunPreview(describeSlash(slashCommand)));
      return;
    }
    await dispatchSlashCommand(slashCommand);
    return;
  }

  // block_actions — approval decision flow.
  const interaction = event.interaction;
  const action = interaction.actions[0];
  if (action === undefined) {
    console.log(
      STRINGS.slackWebhookCommand.unknownEventReason('no action in block_actions payload'),
    );
    return;
  }
  const correlationId = action.value;
  if (correlationId === undefined || correlationId.length === 0) {
    console.log(
      STRINGS.slackWebhookCommand.unknownEventReason(
        'button click missing correlation id (action.value)',
      ),
    );
    return;
  }
  const decision: 'approve' | 'reject' | null =
    action.action_id === 'spex_approve'
      ? 'approve'
      : action.action_id === 'spex_reject'
        ? 'reject'
        : null;
  if (decision === null) {
    console.log(
      STRINGS.slackWebhookCommand.unknownEventReason(
        `button action_id "${action.action_id}" is not an approval decision`,
      ),
    );
    return;
  }
  const existing = await loadApproval(correlationId, { projectDir });
  if (existing === null) {
    console.log(STRINGS.slackWebhookCommand.approvalMissing(correlationId));
    return;
  }
  if (options.dryRun === true) {
    console.log(
      STRINGS.slackWebhookCommand.dryRunPreview(
        `recordDecision(correlationId=${correlationId}, user=${interaction.user.id}, decision=${decision})`,
      ),
    );
    return;
  }
  const result = await recordDecision({
    correlationId,
    userId: interaction.user.id,
    decision,
    options: { projectDir },
  });
  switch (result.kind) {
    case 'recorded':
      console.log(
        STRINGS.slackWebhookCommand.approvalRecorded({
          correlationId,
          userId: interaction.user.id,
          status: result.record.status,
        }),
      );
      return;
    case 'not_approver':
      console.error(STRINGS.slackWebhookCommand.approvalNotApprover(result.userId));
      process.exitCode = 1;
      return;
    case 'duplicate':
      console.error(STRINGS.slackWebhookCommand.approvalDuplicate(result.userId));
      process.exitCode = 1;
      return;
    case 'expired':
      console.error(STRINGS.slackWebhookCommand.approvalExpired);
      process.exitCode = 1;
      return;
    case 'already_finalised':
      console.error(STRINGS.slackWebhookCommand.approvalAlreadyFinalised);
      process.exitCode = 1;
      return;
  }
}

function describePermissionFailure(result: PermissionCheckResult): string {
  switch (result.kind) {
    case 'integration_disabled':
      return 'integrations.slack.slash_commands.enabled is false';
    case 'channel_not_allowed':
      return `channel ${result.channelId} is not in allowed_channels`;
    case 'user_not_allowed':
      return `user ${result.userId} is not in allowed_users`;
    case 'allowed':
      return 'allowed';
  }
}

function describeSlash(command: SpexSlackCommand): string {
  switch (command.kind) {
    case 'review':
      return `runReviewCommand(${command.prRef})`;
    case 'implement':
      return `runImplementCommand("${command.description}")`;
    case 'status':
      return 'listApprovals() — status';
    case 'help':
      return 'help';
    case 'unknown':
      return `unknown subcommand "${command.subcommand}"`;
  }
}

async function dispatchSlashCommand(command: SpexSlackCommand): Promise<void> {
  switch (command.kind) {
    case 'review':
      // Slack-triggered review runs unattended → --auto.
      await runReviewCommand(command.prRef, { auto: true });
      return;
    case 'implement':
      await runImplementCommand(command.description, { auto: true });
      return;
    case 'status': {
      const { listApprovals } = await import('@spex/integrations-slack');
      const pending = await listApprovals({ projectDir: process.cwd(), statusFilter: 'pending' });
      if (pending.length === 0) {
        console.log('No pending approvals.');
        return;
      }
      console.log(`Pending approvals (${pending.length}):`);
      for (const record of pending) {
        console.log(
          `  - ${record.correlationId} • ${record.workflow.kind} • "${record.workflow.title}" (expires ${record.expiresAt})`,
        );
      }
      return;
    }
    case 'help':
    case 'unknown':
      // Help and unknown are no-ops from the receiver's perspective — the
      // user-facing response should already have been posted (in production,
      // by the long-running receiver) before this command runs. The one-shot
      // CLI path just logs and returns.
      console.log('Slash command was help / unknown — no SPEX flow invoked.');
      return;
  }
}

// Re-export for tests that want to fire individual flows without going
// through Commander.
export { dispatchSlashCommand as __dispatchSlashCommandForTest };

// Force-export bug-fix integration so the import is not tree-shaken if not
// referenced elsewhere; `runFixCommand` is reserved here for future approval
// resume flows that resume a paused fix. Wired in via the approval webhook.
// (Marked with `void` to avoid an unused-import lint without invoking it.)
void runFixCommand;
