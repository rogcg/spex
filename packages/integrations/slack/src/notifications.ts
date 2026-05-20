import type { KnownBlock, WebClient } from '@slack/web-api';
import { SpexError } from '@spex/core';
import {
  type FixProposedTemplateInput,
  type PrOpenedTemplateInput,
  type ReviewCompleteTemplateInput,
  type SpecGeneratedTemplateInput,
  buildFixProposedTemplate,
  buildPrOpenedTemplate,
  buildReviewCompleteTemplate,
  buildSpecGeneratedTemplate,
} from './templates/index.js';
import type { SlackBlockKitMessage } from './types.js';

/**
 * Configured channel mappings — mirrors `integrations.slack.channels` in
 * `.ai/config.yaml`. All entries are optional; missing entries fall back to
 * the `default` channel; if neither is set the notification is skipped with
 * a `skipped_no_channel` outcome (NOT thrown — production callers should not
 * fail builds because a Slack post had no destination).
 */
export interface SlackChannelMap {
  pr_opened?: string;
  fix_proposed?: string;
  spec_generated?: string;
  review_complete?: string;
  default?: string;
}

export type SlackNotificationEventType =
  | 'pr_opened'
  | 'fix_proposed'
  | 'spec_generated'
  | 'review_complete';

export type SlackNotifyResult =
  | { kind: 'sent'; channelId: string; ts: string }
  | { kind: 'skipped_no_channel'; eventType: SlackNotificationEventType }
  | { kind: 'error'; eventType: SlackNotificationEventType; error: string };

interface BasePostOptions {
  client: WebClient;
  channels: SlackChannelMap;
  /**
   * When provided, overrides the channel resolved from `channels[event_type]`.
   * Used by the slash-command path that wants to reply to the channel the
   * command came from.
   */
  channelOverride?: string;
  /**
   * Optional `thread_ts` to post the message inside an existing thread. Used
   * by the approval-decision response posts.
   */
  threadTs?: string;
}

function resolveChannel(
  event: SlackNotificationEventType,
  options: BasePostOptions,
): string | null {
  return options.channelOverride ?? options.channels[event] ?? options.channels.default ?? null;
}

async function postMessage(
  options: BasePostOptions & {
    event: SlackNotificationEventType;
    message: SlackBlockKitMessage;
  },
): Promise<SlackNotifyResult> {
  const channel = resolveChannel(options.event, options);
  if (channel === null) {
    return { kind: 'skipped_no_channel', eventType: options.event };
  }
  try {
    const res = await options.client.chat.postMessage({
      channel,
      text: options.message.text,
      // Our templates are intentionally typed as `Record<string, unknown>[]`
      // — Slack's SDK uses a discriminated union (KnownBlock) that would
      // require enumerating every block type at the template surface. Cast
      // at the SDK boundary; the runtime shape matches Block Kit.
      blocks: options.message.blocks as unknown as KnownBlock[],
      ...(options.threadTs !== undefined ? { thread_ts: options.threadTs } : {}),
    });
    const ts = typeof res.ts === 'string' ? res.ts : '';
    const channelId = typeof res.channel === 'string' ? res.channel : channel;
    return { kind: 'sent', channelId, ts };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { kind: 'error', eventType: options.event, error: message };
  }
}

/**
 * Post a "PR opened" notification. Resolves the destination channel from
 * `channels.pr_opened ?? channels.default`.
 */
export async function notifyPrOpened(
  options: BasePostOptions & { input: PrOpenedTemplateInput },
): Promise<SlackNotifyResult> {
  return postMessage({
    ...options,
    event: 'pr_opened',
    message: buildPrOpenedTemplate(options.input),
  });
}

/**
 * Post a "fix proposed — approval requested" notification. Routes to
 * `channels.fix_proposed`.
 */
export async function notifyFixProposed(
  options: BasePostOptions & { input: FixProposedTemplateInput },
): Promise<SlackNotifyResult> {
  return postMessage({
    ...options,
    event: 'fix_proposed',
    message: buildFixProposedTemplate(options.input),
  });
}

/**
 * Post a "feature spec generated" notification. Routes to
 * `channels.spec_generated`.
 */
export async function notifySpecGenerated(
  options: BasePostOptions & { input: SpecGeneratedTemplateInput },
): Promise<SlackNotifyResult> {
  return postMessage({
    ...options,
    event: 'spec_generated',
    message: buildSpecGeneratedTemplate(options.input),
  });
}

/**
 * Post a "review posted on PR" notification. Routes to
 * `channels.review_complete`.
 */
export async function notifyReviewComplete(
  options: BasePostOptions & { input: ReviewCompleteTemplateInput },
): Promise<SlackNotifyResult> {
  return postMessage({
    ...options,
    event: 'review_complete',
    message: buildReviewCompleteTemplate(options.input),
  });
}

export class SlackEphemeralPostError extends SpexError {}

/**
 * Send an ephemeral message to the channel via the short-lived `response_url`
 * Slack delivers with every slash command + interactive payload. This is
 * fire-and-forget — we do not surface a typed result back to the caller. The
 * usual use is the slash-command handler acknowledging "Working on it…" while
 * the long-running SPEX flow continues in the background.
 *
 * Slack's docs: response_url is valid for 30 minutes / 5 calls. Errors are
 * thrown as {@link SlackEphemeralPostError}.
 */
export async function postToResponseUrl(args: {
  responseUrl: string;
  message: SlackBlockKitMessage;
  /** `ephemeral` shows only to the invoker; `in_channel` is visible to all. */
  responseType?: 'ephemeral' | 'in_channel';
  /** When true, replace the original message (e.g. the approval card). */
  replaceOriginal?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const body = {
    text: args.message.text,
    blocks: args.message.blocks,
    response_type: args.responseType ?? 'ephemeral',
    ...(args.replaceOriginal === true ? { replace_original: true } : {}),
  };
  let response: Response;
  try {
    response = await fetchImpl(args.responseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new SlackEphemeralPostError(
      `Slack response_url POST failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new SlackEphemeralPostError(
      `Slack response_url returned HTTP ${response.status}: ${text}`,
    );
  }
}
