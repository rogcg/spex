import { createHmac, timingSafeEqual } from 'node:crypto';
import { SpexError } from '@spex/core';

/**
 * Severity tag PostHog attaches to error-tracking issues. Source of truth is
 * the PostHog "exception level" enumeration (mirrors Sentry's level set).
 */
export type PostHogIssueSeverity = 'critical' | 'error' | 'warning' | 'info' | 'debug';

export const POSTHOG_ISSUE_SEVERITIES: readonly PostHogIssueSeverity[] = [
  'critical',
  'error',
  'warning',
  'info',
  'debug',
] as const;

/**
 * The PostHog webhook event variants SPEX understands. PostHog's
 * error-tracking destinations push two kinds of events:
 *   - `new_issue`  — the first time an exception fingerprint was seen.
 *   - `regression` — an existing issue that had been resolved fired again.
 * Anything else (regular event-action webhooks, status updates, etc.)
 * surfaces as `unknown` and the auto-trigger flow skips it.
 */
export type PostHogWebhookEvent =
  | {
      kind: 'new_issue' | 'regression';
      issueId: string;
      severity: PostHogIssueSeverity | null;
      occurrences: number | null;
      firstSeen: string | null;
      lastSeen: string | null;
    }
  | { kind: 'unknown'; reason: string };

interface RawWebhookPayload {
  type?: string;
  event_type?: string;
  issue?: {
    id?: string;
    issue_id?: string;
    level?: string;
    severity?: string;
    occurrences?: number | string;
    occurrence_count?: number | string;
    first_seen?: string;
    last_seen?: string;
  };
  properties?: {
    $exception_issue_id?: string;
    $exception_level?: string;
    $exception_severity?: string;
  };
}

export class InvalidPostHogWebhookPayloadError extends SpexError {
  constructor(detail: string) {
    super(`Invalid PostHog webhook payload: ${detail}`);
  }
}

/**
 * Parse a PostHog webhook payload (already JSON-decoded). Returns a typed
 * event variant; never throws for *unknown* event types — those surface as
 * `{kind: 'unknown', reason}` so the caller can log + skip without failing
 * the whole webhook delivery.
 *
 * Throws {@link InvalidPostHogWebhookPayloadError} only when the payload is
 * malformed beyond recognition (not an object, or missing every shape we
 * understand).
 */
export function parsePostHogWebhookPayload(payload: unknown): PostHogWebhookEvent {
  if (payload === null || typeof payload !== 'object') {
    throw new InvalidPostHogWebhookPayloadError('payload is not a JSON object');
  }
  const raw = payload as RawWebhookPayload;

  const eventType = (raw.type ?? raw.event_type ?? '').toString().toLowerCase();
  if (eventType === 'new_issue' || eventType === 'regression') {
    const issue = raw.issue;
    if (!issue) {
      return { kind: 'unknown', reason: `event "${eventType}" missing issue object` };
    }
    const issueId = issue.id ?? issue.issue_id ?? null;
    if (issueId === null || issueId.length === 0) {
      return { kind: 'unknown', reason: `event "${eventType}" missing issue id` };
    }
    return {
      kind: eventType,
      issueId,
      severity: normaliseSeverity(issue.level ?? issue.severity ?? null),
      occurrences: normaliseCount(issue.occurrences ?? issue.occurrence_count ?? null),
      firstSeen: issue.first_seen ?? null,
      lastSeen: issue.last_seen ?? null,
    };
  }

  // Fallback: event-action webhooks deliver the raw event with
  // `$exception_issue_id` on properties. Treat that as a new_issue with
  // unknown counts — the caller still has enough to invoke `spex fix`.
  const exceptionIssueId = raw.properties?.$exception_issue_id;
  if (typeof exceptionIssueId === 'string' && exceptionIssueId.length > 0) {
    return {
      kind: 'new_issue',
      issueId: exceptionIssueId,
      severity: normaliseSeverity(
        raw.properties?.$exception_level ?? raw.properties?.$exception_severity ?? null,
      ),
      occurrences: null,
      firstSeen: null,
      lastSeen: null,
    };
  }

  return { kind: 'unknown', reason: 'no recognised event type or $exception_issue_id property' };
}

function normaliseSeverity(value: string | null): PostHogIssueSeverity | null {
  if (value === null) return null;
  const lower = value.toLowerCase();
  return (POSTHOG_ISSUE_SEVERITIES as readonly string[]).includes(lower)
    ? (lower as PostHogIssueSeverity)
    : null;
}

function normaliseCount(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Configuration for the auto-fix filter. Mirrors
 * `integrations.posthog.auto_fix` in `.ai/config.yaml`.
 */
export interface AutoFixFilterConfig {
  enabled: boolean;
  /**
   * Severity levels that pass the filter. Default in the schema is
   * `['critical']`. Events whose severity is unknown (PostHog didn't tag
   * it) pass when this list contains `'critical'` — being conservative
   * means treating unclassified errors as worthy of investigation.
   */
  severity: readonly PostHogIssueSeverity[];
  /**
   * Minimum occurrence count needed to trigger. PostHog may push a webhook
   * on the very first occurrence (occurrences=1) for a noisy app; this lets
   * the user wait until the issue stabilises.
   */
  min_occurrences: number;
}

export type AutoFixDecision =
  | { kind: 'trigger'; issueId: string }
  | { kind: 'skip'; reason: string };

/**
 * Apply the auto-fix filter to a parsed webhook event. Returns either a
 * `trigger` decision (the caller should invoke `spex fix --from-error=
 * posthog:<id> --auto`) or a `skip` with a human-readable reason for logs.
 *
 * The filter rejects regressions by design — re-firing of a resolved issue
 * usually means a manual code change re-introduced the bug, and an
 * unattended AI-generated fix is much riskier than a human triage.
 */
export function decideAutoFix(args: {
  event: PostHogWebhookEvent;
  config: AutoFixFilterConfig;
}): AutoFixDecision {
  const { event, config } = args;
  if (!config.enabled) {
    return { kind: 'skip', reason: 'integrations.posthog.auto_fix.enabled is false' };
  }
  if (event.kind === 'unknown') {
    return { kind: 'skip', reason: `unrecognised event: ${event.reason}` };
  }
  if (event.kind === 'regression') {
    return {
      kind: 'skip',
      reason: 'regression events are filtered out (new issues only)',
    };
  }
  // event.kind === 'new_issue' from here on.
  if (event.severity !== null && !config.severity.includes(event.severity)) {
    return {
      kind: 'skip',
      reason: `severity "${event.severity}" is not in the configured allow-list [${config.severity.join(', ')}]`,
    };
  }
  if (event.severity === null && !config.severity.includes('critical')) {
    return {
      kind: 'skip',
      reason: 'event has no severity tag and the allow-list does not include "critical"',
    };
  }
  if (event.occurrences !== null && event.occurrences < config.min_occurrences) {
    return {
      kind: 'skip',
      reason: `occurrences=${event.occurrences} is below min_occurrences=${config.min_occurrences}`,
    };
  }
  return { kind: 'trigger', issueId: event.issueId };
}

/**
 * Verify a PostHog webhook signature. PostHog signs webhook deliveries with
 * HMAC-SHA256 over the raw request body, using the destination's webhook
 * secret. The expected header value is `sha256=<hex digest>`.
 *
 * Returns `true` when the signature matches, `false` otherwise. Uses
 * timing-safe comparison so the verification time doesn't depend on which
 * byte of the signature differs.
 */
export function verifyPostHogWebhookSignature(args: {
  rawBody: string | Buffer;
  signatureHeader: string | undefined | null;
  secret: string;
}): boolean {
  if (args.signatureHeader === undefined || args.signatureHeader === null) return false;
  if (args.secret.length === 0) return false;
  const header = args.signatureHeader.startsWith('sha256=')
    ? args.signatureHeader.slice('sha256='.length)
    : args.signatureHeader;
  const expected = createHmac('sha256', args.secret)
    .update(typeof args.rawBody === 'string' ? args.rawBody : args.rawBody)
    .digest('hex');
  const a = Buffer.from(header, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
