import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { InvalidAiConfigError, loadAiConfig } from '@spex/core';
import {
  type AutoFixDecision,
  type AutoFixFilterConfig,
  InvalidPostHogWebhookPayloadError,
  type PostHogWebhookEvent,
  decideAutoFix,
  parsePostHogWebhookPayload,
  verifyPostHogWebhookSignature,
} from '@spex/integrations-posthog';
import { STRINGS } from '../strings.js';
import { runFixCommand } from './fix.js';

export interface PostHogWebhookCommandOptions {
  /** Path to a JSON file containing the webhook payload. */
  payloadPath?: string;
  /**
   * Signature header value (typically `X-PostHog-Signature: sha256=…`).
   * When supplied alongside `--secret`, the payload is rejected unless the
   * HMAC verifies.
   */
  signature?: string;
  /**
   * Webhook secret. Defaults to `process.env.POSTHOG_WEBHOOK_SECRET`. When
   * absent (and `--signature` is absent), signature verification is skipped
   * with a warning — fine for local testing, not for production.
   */
  secret?: string;
  /** When true, parse + decide but do not invoke `spex fix`. */
  dryRun?: boolean;
}

/**
 * Handle an incoming PostHog webhook delivery. Reads the JSON payload from
 * `--payload-path`, parses it, applies the auto-fix filter from
 * `.ai/config.yaml`, and on a `trigger` decision invokes
 * `runFixCommand({ fromError: 'posthog:<id>', auto: true })`.
 *
 * The command always exits 0 on a clean skip so the calling GitHub Action
 * (or whatever delivery proxy is in front of PostHog) does not retry. It
 * exits 1 only on configuration errors, signature failures, or fix-flow
 * failures.
 */
export async function runPostHogWebhookCommand(
  options: PostHogWebhookCommandOptions = {},
): Promise<void> {
  const projectDir = resolve(process.cwd());

  // Phase 1: load config + the auto_fix block.
  let autoFix: AutoFixFilterConfig | null = null;
  try {
    const config = await loadAiConfig({ projectDir });
    const posthogConfig = config?.integrations?.posthog;
    if (!posthogConfig) {
      console.error(STRINGS.posthogWebhookCommand.integrationNotConfigured);
      process.exitCode = 1;
      return;
    }
    autoFix = posthogConfig.auto_fix;
  } catch (cause) {
    if (cause instanceof InvalidAiConfigError) {
      console.error(STRINGS.posthogWebhookCommand.invalidConfig(cause.issues));
      process.exitCode = 1;
      return;
    }
    throw cause;
  }

  // Phase 2: read the webhook payload.
  if (options.payloadPath === undefined) {
    console.error(STRINGS.posthogWebhookCommand.missingPayloadPath);
    process.exitCode = 1;
    return;
  }
  let rawBody: string;
  try {
    rawBody = await readFile(options.payloadPath, 'utf8');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(STRINGS.posthogWebhookCommand.payloadReadFailed(options.payloadPath, message));
    process.exitCode = 1;
    return;
  }

  // Phase 3: optional signature verification.
  const secret = options.secret ?? process.env.POSTHOG_WEBHOOK_SECRET;
  if (options.signature !== undefined) {
    if (secret === undefined || secret.length === 0) {
      console.error(STRINGS.posthogWebhookCommand.signatureWithoutSecret);
      process.exitCode = 1;
      return;
    }
    const ok = verifyPostHogWebhookSignature({
      rawBody,
      signatureHeader: options.signature,
      secret,
    });
    if (!ok) {
      console.error(STRINGS.posthogWebhookCommand.signatureMismatch);
      process.exitCode = 1;
      return;
    }
    console.log(STRINGS.posthogWebhookCommand.signatureVerified);
  } else if (secret !== undefined && secret.length > 0) {
    console.log(STRINGS.posthogWebhookCommand.signatureSkippedWithSecret);
  } else {
    console.log(STRINGS.posthogWebhookCommand.signatureSkippedNoSecret);
  }

  // Phase 4: parse the payload.
  let event: PostHogWebhookEvent;
  try {
    const parsedJson: unknown = JSON.parse(rawBody);
    event = parsePostHogWebhookPayload(parsedJson);
  } catch (cause) {
    if (cause instanceof InvalidPostHogWebhookPayloadError) {
      console.error(STRINGS.posthogWebhookCommand.invalidPayload(cause.message));
      process.exitCode = 1;
      return;
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(STRINGS.posthogWebhookCommand.invalidPayload(message));
    process.exitCode = 1;
    return;
  }

  console.log(STRINGS.posthogWebhookCommand.eventSummary(event));

  // Phase 5: apply the filter.
  const decision: AutoFixDecision = decideAutoFix({ event, config: autoFix });
  if (decision.kind === 'skip') {
    console.log(STRINGS.posthogWebhookCommand.skipped(decision.reason));
    return;
  }

  if (options.dryRun === true) {
    console.log(STRINGS.posthogWebhookCommand.dryRunTrigger(decision.issueId));
    return;
  }

  // Phase 6: hand off to runFixCommand.
  console.log(STRINGS.posthogWebhookCommand.triggering(decision.issueId));
  await runFixCommand(undefined, {
    fromError: `posthog:${decision.issueId}`,
    auto: true,
  });
}
