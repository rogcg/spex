import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type AutoFixFilterConfig,
  InvalidPostHogWebhookPayloadError,
  type PostHogIssueSeverity,
  decideAutoFix,
  parsePostHogWebhookPayload,
  verifyPostHogWebhookSignature,
} from './webhook.js';

describe('parsePostHogWebhookPayload', () => {
  it('parses a new_issue event from the error-tracking destination shape', () => {
    const event = parsePostHogWebhookPayload({
      type: 'new_issue',
      issue: {
        id: 'iss_abc123',
        level: 'error',
        occurrences: 7,
        first_seen: '2026-05-15T12:34:56Z',
        last_seen: '2026-05-19T08:12:30Z',
      },
    });
    expect(event).toEqual({
      kind: 'new_issue',
      issueId: 'iss_abc123',
      severity: 'error',
      occurrences: 7,
      firstSeen: '2026-05-15T12:34:56Z',
      lastSeen: '2026-05-19T08:12:30Z',
    });
  });

  it('parses a regression event the same way', () => {
    const event = parsePostHogWebhookPayload({
      type: 'regression',
      issue: { id: 'iss_xyz', level: 'critical', occurrence_count: '42' },
    });
    expect(event).toEqual({
      kind: 'regression',
      issueId: 'iss_xyz',
      severity: 'critical',
      occurrences: 42,
      firstSeen: null,
      lastSeen: null,
    });
  });

  it('falls back to $exception_issue_id property when no top-level type is present', () => {
    const event = parsePostHogWebhookPayload({
      event_type: '$exception',
      properties: {
        $exception_issue_id: 'iss_from_props',
        $exception_level: 'CRITICAL',
      },
    });
    expect(event).toEqual({
      kind: 'new_issue',
      issueId: 'iss_from_props',
      severity: 'critical',
      occurrences: null,
      firstSeen: null,
      lastSeen: null,
    });
  });

  it('returns kind=unknown when the event type is unrecognised', () => {
    const event = parsePostHogWebhookPayload({ type: 'survey_completed' });
    expect(event.kind).toBe('unknown');
  });

  it('returns kind=unknown when a new_issue event is missing the issue object', () => {
    const event = parsePostHogWebhookPayload({ type: 'new_issue' });
    expect(event.kind).toBe('unknown');
  });

  it('returns kind=unknown when a new_issue event is missing the issue id', () => {
    const event = parsePostHogWebhookPayload({ type: 'new_issue', issue: { level: 'error' } });
    expect(event.kind).toBe('unknown');
  });

  it('returns severity=null when PostHog tags an unknown level value', () => {
    const event = parsePostHogWebhookPayload({
      type: 'new_issue',
      issue: { id: 'iss_x', level: 'huh' },
    });
    expect(event.kind === 'new_issue' ? event.severity : null).toBeNull();
  });

  it('throws InvalidPostHogWebhookPayloadError when payload is not an object', () => {
    expect(() => parsePostHogWebhookPayload(null)).toThrow(InvalidPostHogWebhookPayloadError);
    expect(() => parsePostHogWebhookPayload('hi')).toThrow(InvalidPostHogWebhookPayloadError);
    expect(() => parsePostHogWebhookPayload([])).not.toThrow(); // array IS an object — falls into unknown
  });
});

const DEFAULT_CONFIG: AutoFixFilterConfig = {
  enabled: true,
  severity: ['critical'],
  min_occurrences: 5,
};

describe('decideAutoFix', () => {
  it('triggers on a new_issue event when severity + min_occurrences pass', () => {
    const decision = decideAutoFix({
      event: {
        kind: 'new_issue',
        issueId: 'iss_abc',
        severity: 'critical',
        occurrences: 10,
        firstSeen: null,
        lastSeen: null,
      },
      config: DEFAULT_CONFIG,
    });
    expect(decision).toEqual({ kind: 'trigger', issueId: 'iss_abc' });
  });

  it('skips when enabled is false', () => {
    const decision = decideAutoFix({
      event: {
        kind: 'new_issue',
        issueId: 'iss_abc',
        severity: 'critical',
        occurrences: 10,
        firstSeen: null,
        lastSeen: null,
      },
      config: { ...DEFAULT_CONFIG, enabled: false },
    });
    expect(decision).toEqual({
      kind: 'skip',
      reason: 'integrations.posthog.auto_fix.enabled is false',
    });
  });

  it('skips regressions even when they otherwise match', () => {
    const decision = decideAutoFix({
      event: {
        kind: 'regression',
        issueId: 'iss_abc',
        severity: 'critical',
        occurrences: 99,
        firstSeen: null,
        lastSeen: null,
      },
      config: DEFAULT_CONFIG,
    });
    expect(decision.kind).toBe('skip');
    expect((decision as { reason: string }).reason).toContain('regression');
  });

  it('skips unknown events with the parser-supplied reason', () => {
    const decision = decideAutoFix({
      event: { kind: 'unknown', reason: 'no recognised event type' },
      config: DEFAULT_CONFIG,
    });
    expect(decision).toEqual({
      kind: 'skip',
      reason: 'unrecognised event: no recognised event type',
    });
  });

  it('skips when severity is not in the allow-list', () => {
    const decision = decideAutoFix({
      event: {
        kind: 'new_issue',
        issueId: 'iss_abc',
        severity: 'warning',
        occurrences: 100,
        firstSeen: null,
        lastSeen: null,
      },
      config: DEFAULT_CONFIG,
    });
    expect(decision.kind).toBe('skip');
    expect((decision as { reason: string }).reason).toContain('warning');
  });

  it('passes when severity is null and allow-list includes critical', () => {
    const decision = decideAutoFix({
      event: {
        kind: 'new_issue',
        issueId: 'iss_abc',
        severity: null,
        occurrences: 10,
        firstSeen: null,
        lastSeen: null,
      },
      config: DEFAULT_CONFIG,
    });
    expect(decision).toEqual({ kind: 'trigger', issueId: 'iss_abc' });
  });

  it('skips when severity is null and allow-list excludes critical', () => {
    const config: AutoFixFilterConfig = {
      ...DEFAULT_CONFIG,
      severity: ['error' as PostHogIssueSeverity],
    };
    const decision = decideAutoFix({
      event: {
        kind: 'new_issue',
        issueId: 'iss_abc',
        severity: null,
        occurrences: 10,
        firstSeen: null,
        lastSeen: null,
      },
      config,
    });
    expect(decision.kind).toBe('skip');
  });

  it('skips when occurrences is below min_occurrences', () => {
    const decision = decideAutoFix({
      event: {
        kind: 'new_issue',
        issueId: 'iss_abc',
        severity: 'critical',
        occurrences: 2,
        firstSeen: null,
        lastSeen: null,
      },
      config: DEFAULT_CONFIG,
    });
    expect(decision.kind).toBe('skip');
    expect((decision as { reason: string }).reason).toContain('min_occurrences=5');
  });

  it('passes when occurrences is null (no count from PostHog)', () => {
    const decision = decideAutoFix({
      event: {
        kind: 'new_issue',
        issueId: 'iss_abc',
        severity: 'critical',
        occurrences: null,
        firstSeen: null,
        lastSeen: null,
      },
      config: DEFAULT_CONFIG,
    });
    expect(decision).toEqual({ kind: 'trigger', issueId: 'iss_abc' });
  });
});

describe('verifyPostHogWebhookSignature', () => {
  const SECRET = 'wh_super_secret';
  const body = JSON.stringify({ type: 'new_issue', issue: { id: 'iss_x' } });
  const expectedDigest = createHmac('sha256', SECRET).update(body).digest('hex');

  it('accepts a matching sha256-prefixed header', () => {
    const ok = verifyPostHogWebhookSignature({
      rawBody: body,
      signatureHeader: `sha256=${expectedDigest}`,
      secret: SECRET,
    });
    expect(ok).toBe(true);
  });

  it('accepts a matching bare hex digest (no prefix)', () => {
    const ok = verifyPostHogWebhookSignature({
      rawBody: body,
      signatureHeader: expectedDigest,
      secret: SECRET,
    });
    expect(ok).toBe(true);
  });

  it('rejects a different secret', () => {
    const ok = verifyPostHogWebhookSignature({
      rawBody: body,
      signatureHeader: `sha256=${expectedDigest}`,
      secret: 'wrong_secret',
    });
    expect(ok).toBe(false);
  });

  it('rejects when the header is missing', () => {
    expect(
      verifyPostHogWebhookSignature({ rawBody: body, signatureHeader: undefined, secret: SECRET }),
    ).toBe(false);
    expect(
      verifyPostHogWebhookSignature({ rawBody: body, signatureHeader: null, secret: SECRET }),
    ).toBe(false);
  });

  it('rejects when the secret is empty', () => {
    expect(
      verifyPostHogWebhookSignature({
        rawBody: body,
        signatureHeader: `sha256=${expectedDigest}`,
        secret: '',
      }),
    ).toBe(false);
  });

  it('rejects a tampered body', () => {
    const ok = verifyPostHogWebhookSignature({
      rawBody: `${body}tampered`,
      signatureHeader: `sha256=${expectedDigest}`,
      secret: SECRET,
    });
    expect(ok).toBe(false);
  });

  it('handles Buffer bodies', () => {
    const ok = verifyPostHogWebhookSignature({
      rawBody: Buffer.from(body, 'utf8'),
      signatureHeader: `sha256=${expectedDigest}`,
      secret: SECRET,
    });
    expect(ok).toBe(true);
  });
});
