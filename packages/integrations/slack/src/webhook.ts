import { createHmac, timingSafeEqual } from 'node:crypto';
import { SpexError } from '@spex/core';
import type { SlackButtonInteraction, SlackSlashCommand, SlackWebhookEvent } from './types.js';

/**
 * Slack rejects request signatures where the timestamp is more than 5 minutes
 * old (replay-attack window). SPEX matches Slack's published constant exactly.
 */
export const SLACK_SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

const SIGNATURE_VERSION = 'v0';

export class InvalidSlackWebhookPayloadError extends SpexError {
  constructor(detail: string) {
    super(`Invalid Slack webhook payload: ${detail}`);
  }
}

export interface VerifySlackSignatureOptions {
  /** Raw request body as Slack sent it. Must not be re-serialised. */
  rawBody: string | Buffer;
  /** Value of the `X-Slack-Signature` header (`v0=<hex>`). */
  signatureHeader: string | undefined | null;
  /** Value of the `X-Slack-Request-Timestamp` header (unix seconds). */
  timestampHeader: string | undefined | null;
  /** Slack signing secret (from the app's Basic Information page). */
  signingSecret: string;
  /**
   * Override "now" used in the timestamp freshness check. Tests inject a
   * fixed clock here; production callers normally let it default.
   */
  now?: Date;
}

/**
 * Verify a Slack request signature against the documented v0 scheme:
 *
 *   sig_basestring = `v0:<timestamp>:<raw_body>`
 *   expected       = `v0=` + HMAC-SHA256(signing_secret, sig_basestring) hex
 *
 * Returns `true` only when the signature, timestamp freshness, and HMAC all
 * line up. Uses {@link timingSafeEqual} so signature comparison time is
 * independent of which byte differs.
 *
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(options: VerifySlackSignatureOptions): boolean {
  if (
    options.signatureHeader === undefined ||
    options.signatureHeader === null ||
    options.timestampHeader === undefined ||
    options.timestampHeader === null ||
    options.signingSecret.length === 0
  ) {
    return false;
  }
  const ts = Number(options.timestampHeader);
  if (!Number.isFinite(ts)) return false;
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - ts) > SLACK_SIGNATURE_MAX_AGE_SECONDS) {
    return false;
  }
  const body =
    typeof options.rawBody === 'string' ? options.rawBody : options.rawBody.toString('utf8');
  const basestring = `${SIGNATURE_VERSION}:${options.timestampHeader}:${body}`;
  const expected = `${SIGNATURE_VERSION}=${createHmac('sha256', options.signingSecret)
    .update(basestring)
    .digest('hex')}`;
  const a = Buffer.from(options.signatureHeader, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Parse a Slack webhook delivery into one of three variants:
 *   - `slash_command` — form-encoded body with `command=/spex...`.
 *   - `block_actions` — form-encoded body with `payload=<json>` containing a
 *     `type: "block_actions"` interactive payload (button click).
 *   - `unknown` — anything else; the caller logs + skips.
 *
 * Slash commands and interactive payloads both arrive as
 * `application/x-www-form-urlencoded`. The parser uses `URLSearchParams` to
 * decode the body, then routes to the right variant. Slack's `events_api`
 * JSON shape is intentionally NOT handled — SPEX does not yet listen for
 * passive events (channel messages, app mentions); those return `unknown`.
 *
 * Throws {@link InvalidSlackWebhookPayloadError} only when the body is
 * unparseable.
 */
export function parseSlackWebhookPayload(rawBody: string): SlackWebhookEvent {
  if (rawBody.length === 0) {
    throw new InvalidSlackWebhookPayloadError('empty body');
  }
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(rawBody);
  } catch (cause) {
    throw new InvalidSlackWebhookPayloadError(
      `body is not URL-encoded: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  // Slash command path: presence of `command=...` is the discriminator.
  const command = params.get('command');
  if (command !== null && command.length > 0) {
    return parseSlashCommand(params);
  }

  // Interactive payload path: Slack wraps the JSON in a `payload` field.
  const payloadField = params.get('payload');
  if (payloadField !== null && payloadField.length > 0) {
    let raw: unknown;
    try {
      raw = JSON.parse(payloadField);
    } catch (cause) {
      throw new InvalidSlackWebhookPayloadError(
        `interactive payload is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    return parseInteractivePayload(raw);
  }

  return { kind: 'unknown', reason: 'no `command` or `payload` field in form-encoded body' };
}

function parseSlashCommand(params: URLSearchParams): SlackWebhookEvent {
  const command = params.get('command') ?? '';
  // The text field is sometimes empty (`/spex` with no args).
  const text = params.get('text') ?? '';
  const userId = params.get('user_id');
  const userName = params.get('user_name') ?? '';
  const channelId = params.get('channel_id');
  const teamId = params.get('team_id');
  const responseUrl = params.get('response_url') ?? '';
  const triggerId = params.get('trigger_id') ?? '';
  if (userId === null || channelId === null || teamId === null) {
    return {
      kind: 'unknown',
      reason: 'slash command missing required user_id / channel_id / team_id',
    };
  }
  const slash: SlackSlashCommand = {
    command,
    text,
    userId,
    userName,
    channelId,
    teamId,
    responseUrl,
    triggerId,
  };
  return { kind: 'slash_command', command: slash };
}

function parseInteractivePayload(raw: unknown): SlackWebhookEvent {
  if (raw === null || typeof raw !== 'object') {
    return { kind: 'unknown', reason: 'interactive payload is not an object' };
  }
  const payload = raw as Record<string, unknown>;
  if (payload.type !== 'block_actions') {
    return {
      kind: 'unknown',
      reason: `interactive payload type "${String(payload.type)}" is not block_actions`,
    };
  }
  const user = payload.user as { id?: unknown; name?: unknown; team_id?: unknown } | undefined;
  const team = payload.team as { id?: unknown; domain?: unknown } | undefined;
  const channel = payload.channel as { id?: unknown; name?: unknown } | undefined;
  const message = payload.message as { ts?: unknown; text?: unknown } | undefined;
  const actions = Array.isArray(payload.actions) ? (payload.actions as unknown[]) : [];
  if (
    !user ||
    typeof user.id !== 'string' ||
    !team ||
    typeof team.id !== 'string' ||
    !channel ||
    typeof channel.id !== 'string' ||
    actions.length === 0
  ) {
    return {
      kind: 'unknown',
      reason: 'block_actions payload is missing user / team / channel / actions',
    };
  }
  const typedActions: SlackButtonInteraction['actions'] = [];
  for (const entry of actions) {
    if (entry === null || typeof entry !== 'object') continue;
    const act = entry as Record<string, unknown>;
    if (
      typeof act.action_id !== 'string' ||
      typeof act.block_id !== 'string' ||
      act.type !== 'button'
    ) {
      continue;
    }
    typedActions.push({
      action_id: act.action_id,
      block_id: act.block_id,
      value: typeof act.value === 'string' ? act.value : undefined,
      type: 'button',
    });
  }
  if (typedActions.length === 0) {
    return {
      kind: 'unknown',
      reason: 'block_actions payload had no button actions',
    };
  }
  const interaction: SlackButtonInteraction = {
    type: 'block_actions',
    user: {
      id: user.id,
      name: typeof user.name === 'string' ? user.name : '',
      team_id: typeof user.team_id === 'string' ? user.team_id : team.id,
    },
    team: {
      id: team.id,
      domain: typeof team.domain === 'string' ? team.domain : '',
    },
    channel: {
      id: channel.id,
      name: typeof channel.name === 'string' ? channel.name : '',
    },
    message: {
      ts: message && typeof message.ts === 'string' ? message.ts : '',
      text: message && typeof message.text === 'string' ? message.text : '',
    },
    actions: typedActions,
    response_url: typeof payload.response_url === 'string' ? payload.response_url : '',
    raw: payload,
  };
  return { kind: 'block_actions', interaction };
}
