// Slack domain types used by the SPEX integration. These mirror the subset of
// Slack's REST + Block Kit + Events shapes we actually consume — kept narrow on
// purpose so callers get strongly-typed results without dragging in every
// optional field Slack documents.

/**
 * A Slack Block Kit block. We do not enumerate every block type Slack ships
 * — the official `@slack/types` definitions are large and change frequently.
 * Treating templates as `unknown[]` would lose all type help; treating them
 * as `Record<string, unknown>` keeps shape help while allowing forward-compat.
 */
export type SlackBlock = Record<string, unknown>;

/**
 * Slack "section" / "actions" / etc. Anything we hand to chat.postMessage as
 * `blocks` is an array of these. Composition stays open by design.
 */
export type SlackBlockKitMessage = {
  blocks: SlackBlock[];
  text: string;
};

/**
 * Authentication credential pair stored on disk per workspace. `team.id` is
 * Slack's workspace identifier; `accessToken` is the long-lived bot token
 * obtained via the OAuth v2 install flow (xoxb-...).
 */
export interface SlackWorkspaceTokens {
  team: { id: string; name: string };
  appId: string;
  /** xoxb-... — the bot token used for chat.postMessage etc. */
  accessToken: string;
  /** Bot user id; surfaced so commands can ignore self-events. */
  botUserId: string;
  /** Scopes granted at install time. Used for diagnostics. */
  scope: string;
  /** ISO-8601 timestamp the token was issued. */
  installedAt: string;
  /** xoxe-... refresh token (optional; only present for token-rotation apps). */
  refreshToken?: string;
  /** Seconds the access token is valid for (token-rotation apps only). */
  expiresIn?: number;
}

/**
 * Parsed slash-command body (Slack POSTs these as form-encoded data). Slack
 * delivers form-encoded payloads with `command=/spex&text=review ...`. The
 * fields below are the universal subset SPEX cares about.
 */
export interface SlackSlashCommand {
  /** `/spex` etc. (with the leading slash). */
  command: string;
  /** Free-form argument string (e.g. `review https://github.com/...`). */
  text: string;
  /** ID of the user who invoked the command. */
  userId: string;
  /** Human-readable username (NOT a stable identifier — display only). */
  userName: string;
  /** Slack channel id the command was invoked from. */
  channelId: string;
  /** Slack workspace (team) id the command came from. */
  teamId: string;
  /** Short-lived response URL Slack expects async responses on (5 calls / 30min). */
  responseUrl: string;
  /** One-time trigger id for opening modals (~3s validity). */
  triggerId: string;
}

/**
 * Subset of the `block_actions` interactive-payload shape Slack POSTs when a
 * user clicks a button on a message we sent. Only the fields used by SPEX's
 * approval flow are typed — the rest stays accessible via `raw`.
 */
export interface SlackButtonInteraction {
  /** Always `block_actions` for button clicks. */
  type: 'block_actions';
  /** Slack user that pressed the button. */
  user: { id: string; name: string; team_id: string };
  team: { id: string; domain: string };
  channel: { id: string; name: string };
  message: { ts: string; text: string };
  /** The button(s) the user clicked. SPEX uses element 0. */
  actions: Array<{
    action_id: string;
    block_id: string;
    /** Application-defined value, used by SPEX to thread the correlation id. */
    value: string | undefined;
    type: 'button';
  }>;
  /** Short-lived URL to post the post-decision update to. */
  response_url: string;
  /** Raw payload exposed for callers that need a field we did not surface. */
  raw: Record<string, unknown>;
}

/**
 * Parsed Slack webhook event. SPEX understands two kinds: slash commands and
 * `block_actions` interactive payloads (button clicks on approval messages).
 * Anything else surfaces as `unknown` and the receiver logs + skips.
 */
export type SlackWebhookEvent =
  | { kind: 'slash_command'; command: SlackSlashCommand }
  | { kind: 'block_actions'; interaction: SlackButtonInteraction }
  | { kind: 'unknown'; reason: string };
