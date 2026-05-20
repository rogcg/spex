import { SpexError } from '@spex/core';
import type { SlackSlashCommand } from './types.js';

export class InvalidSlackCommandError extends SpexError {}

/**
 * Parsed SPEX slash sub-command. The receiver invokes the SPEX flow that
 * matches `kind`; the `raw` arguments are passed through as the description /
 * PR ref.
 */
export type SpexSlackCommand =
  | { kind: 'review'; prRef: string; userId: string; channelId: string; responseUrl: string }
  | {
      kind: 'implement';
      description: string;
      userId: string;
      channelId: string;
      responseUrl: string;
    }
  | { kind: 'status'; userId: string; channelId: string; responseUrl: string }
  | { kind: 'help'; userId: string; channelId: string; responseUrl: string }
  | { kind: 'unknown'; subcommand: string; userId: string; channelId: string; responseUrl: string };

/**
 * Parse the text payload of a `/spex` slash command into a discriminated
 * union. The receiver matches on `kind` and dispatches; this stays a pure
 * function so it is trivially testable.
 *
 * Examples:
 *   "/spex" / "/spex help"                       → { kind: 'help' }
 *   "/spex review <pr-url>"                      → { kind: 'review', prRef }
 *   "/spex implement add user pagination"        → { kind: 'implement', description }
 *   "/spex status"                               → { kind: 'status' }
 *   "/spex blast off"                            → { kind: 'unknown', subcommand: 'blast' }
 */
export function parseSpexSlashCommand(command: SlackSlashCommand): SpexSlackCommand {
  const text = command.text.trim();
  if (text.length === 0) {
    return commonFields({ kind: 'help' }, command);
  }
  const firstSpace = text.indexOf(' ');
  const subcommand = (firstSpace === -1 ? text : text.slice(0, firstSpace)).toLowerCase();
  const remainder = firstSpace === -1 ? '' : text.slice(firstSpace + 1).trim();

  switch (subcommand) {
    case 'help':
      return commonFields({ kind: 'help' }, command);
    case 'status':
      return commonFields({ kind: 'status' }, command);
    case 'review':
      if (remainder.length === 0) {
        return commonFields({ kind: 'unknown', subcommand: 'review (missing pr-ref)' }, command);
      }
      return commonFields({ kind: 'review', prRef: remainder }, command);
    case 'implement':
      if (remainder.length === 0) {
        return commonFields(
          { kind: 'unknown', subcommand: 'implement (missing description)' },
          command,
        );
      }
      return commonFields({ kind: 'implement', description: remainder }, command);
    default:
      return commonFields({ kind: 'unknown', subcommand }, command);
  }
}

function commonFields<T extends { kind: string }>(
  partial: T,
  command: SlackSlashCommand,
): T & { userId: string; channelId: string; responseUrl: string } {
  return {
    ...partial,
    userId: command.userId,
    channelId: command.channelId,
    responseUrl: command.responseUrl,
  };
}

/**
 * Permission rules from `integrations.slack.slash_commands` in
 * `.ai/config.yaml`. Default: no restrictions on `status`/`help`; `review`
 * and `implement` are restricted to `allowed_users` when set.
 */
export interface SlashCommandPermissionConfig {
  enabled: boolean;
  /**
   * Allow-list of Slack user IDs for state-changing commands. When `null` or
   * empty, the command is unrestricted. Read-only commands (`status`,
   * `help`) are never restricted.
   */
  allowed_users?: readonly string[];
  /** Allow-list of Slack channel IDs. When set, commands are rejected from other channels. */
  allowed_channels?: readonly string[];
}

export type PermissionCheckResult =
  | { kind: 'allowed' }
  | { kind: 'integration_disabled' }
  | { kind: 'channel_not_allowed'; channelId: string }
  | { kind: 'user_not_allowed'; userId: string };

/**
 * Decide whether a given slash sub-command is allowed to run. Pure function.
 *
 * Returns:
 *   - `allowed` when the call is permitted.
 *   - `integration_disabled` when `enabled=false` in config.
 *   - `channel_not_allowed` when the command came from a channel outside
 *     `allowed_channels`.
 *   - `user_not_allowed` for state-changing commands invoked by a user not
 *     in `allowed_users`.
 *
 * `help` and `status` always pass the user gate — they are read-only and
 * harmless from any approved channel.
 */
export function checkSlashPermission(args: {
  command: SpexSlackCommand;
  config: SlashCommandPermissionConfig;
}): PermissionCheckResult {
  if (args.config.enabled === false) return { kind: 'integration_disabled' };
  const allowedChannels = args.config.allowed_channels;
  if (allowedChannels !== undefined && allowedChannels.length > 0) {
    if (!allowedChannels.includes(args.command.channelId)) {
      return { kind: 'channel_not_allowed', channelId: args.command.channelId };
    }
  }
  const stateChanging = args.command.kind === 'review' || args.command.kind === 'implement';
  if (stateChanging) {
    const allowedUsers = args.config.allowed_users;
    if (allowedUsers !== undefined && allowedUsers.length > 0) {
      if (!allowedUsers.includes(args.command.userId)) {
        return { kind: 'user_not_allowed', userId: args.command.userId };
      }
    }
  }
  return { kind: 'allowed' };
}

/**
 * Static help text printed in response to `/spex help` or when an unknown
 * sub-command is invoked. Plain markdown rendered by Slack's mrkdwn parser.
 */
export const SPEX_SLASH_HELP_TEXT = [
  '*SPEX slash commands*',
  '• `/spex review <pr-url>` — run `spex review` on a GitHub PR and post the verdict here.',
  '• `/spex implement <description>` — kick off `spex implement` in the background; result posts here.',
  '• `/spex status` — list pending approvals + active workflows.',
  '• `/spex help` — show this message.',
].join('\n');
