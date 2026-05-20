import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  InvalidSlackWebhookPayloadError,
  SLACK_SIGNATURE_MAX_AGE_SECONDS,
  parseSlackWebhookPayload,
  verifySlackSignature,
} from './webhook.js';

describe('verifySlackSignature', () => {
  const SECRET = 'shh-very-secret';
  const NOW = new Date('2026-05-19T12:00:00Z');
  const TIMESTAMP = Math.floor(NOW.getTime() / 1000).toString();
  const body = 'token=xxx&command=/spex&text=help';
  const digest = createHmac('sha256', SECRET).update(`v0:${TIMESTAMP}:${body}`).digest('hex');

  it('accepts a valid v0-prefixed signature', () => {
    expect(
      verifySlackSignature({
        rawBody: body,
        signatureHeader: `v0=${digest}`,
        timestampHeader: TIMESTAMP,
        signingSecret: SECRET,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('rejects when the secret differs', () => {
    expect(
      verifySlackSignature({
        rawBody: body,
        signatureHeader: `v0=${digest}`,
        timestampHeader: TIMESTAMP,
        signingSecret: 'wrong',
        now: NOW,
      }),
    ).toBe(false);
  });

  it('rejects when the body has been tampered with', () => {
    expect(
      verifySlackSignature({
        rawBody: `${body}&extra=1`,
        signatureHeader: `v0=${digest}`,
        timestampHeader: TIMESTAMP,
        signingSecret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('rejects timestamps older than the 5-minute window', () => {
    const stale = (
      Math.floor(NOW.getTime() / 1000) -
      SLACK_SIGNATURE_MAX_AGE_SECONDS -
      1
    ).toString();
    const staleDigest = createHmac('sha256', SECRET).update(`v0:${stale}:${body}`).digest('hex');
    expect(
      verifySlackSignature({
        rawBody: body,
        signatureHeader: `v0=${staleDigest}`,
        timestampHeader: stale,
        signingSecret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('rejects when the timestamp is missing or non-numeric', () => {
    expect(
      verifySlackSignature({
        rawBody: body,
        signatureHeader: `v0=${digest}`,
        timestampHeader: null,
        signingSecret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifySlackSignature({
        rawBody: body,
        signatureHeader: `v0=${digest}`,
        timestampHeader: 'nope',
        signingSecret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('rejects when the signature header is missing', () => {
    expect(
      verifySlackSignature({
        rawBody: body,
        signatureHeader: undefined,
        timestampHeader: TIMESTAMP,
        signingSecret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('accepts a Buffer body', () => {
    expect(
      verifySlackSignature({
        rawBody: Buffer.from(body, 'utf8'),
        signatureHeader: `v0=${digest}`,
        timestampHeader: TIMESTAMP,
        signingSecret: SECRET,
        now: NOW,
      }),
    ).toBe(true);
  });
});

describe('parseSlackWebhookPayload', () => {
  it('parses a slash command body', () => {
    const body = new URLSearchParams({
      token: 'verification',
      team_id: 'T01',
      channel_id: 'C01',
      user_id: 'U01',
      user_name: 'roger',
      command: '/spex',
      text: 'review https://github.com/foo/bar/pull/42',
      response_url: 'https://hooks.slack.com/commands/abc',
      trigger_id: '123.456.abc',
    }).toString();
    const result = parseSlackWebhookPayload(body);
    expect(result.kind).toBe('slash_command');
    if (result.kind !== 'slash_command') throw new Error('expected slash_command');
    expect(result.command.command).toBe('/spex');
    expect(result.command.text).toBe('review https://github.com/foo/bar/pull/42');
    expect(result.command.userId).toBe('U01');
    expect(result.command.channelId).toBe('C01');
    expect(result.command.teamId).toBe('T01');
    expect(result.command.responseUrl).toBe('https://hooks.slack.com/commands/abc');
    expect(result.command.triggerId).toBe('123.456.abc');
  });

  it('returns unknown when a slash command is missing user/channel/team ids', () => {
    const body = new URLSearchParams({ command: '/spex', text: 'help' }).toString();
    const result = parseSlackWebhookPayload(body);
    expect(result.kind).toBe('unknown');
  });

  it('parses a block_actions interactive payload', () => {
    const payload = {
      type: 'block_actions',
      user: { id: 'U99', name: 'maintainer', team_id: 'T01' },
      team: { id: 'T01', domain: 'spex' },
      channel: { id: 'C42', name: 'alerts' },
      message: { ts: '1716123456.000200', text: 'fix proposed' },
      response_url: 'https://hooks.slack.com/actions/abc',
      actions: [
        {
          action_id: 'spex_approve',
          block_id: 'spex_approval_actions',
          value: 'spex-approval-deadbeef',
          type: 'button',
        },
      ],
    };
    const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
    const result = parseSlackWebhookPayload(body);
    expect(result.kind).toBe('block_actions');
    if (result.kind !== 'block_actions') throw new Error('expected block_actions');
    expect(result.interaction.user.id).toBe('U99');
    expect(result.interaction.actions[0]?.action_id).toBe('spex_approve');
    expect(result.interaction.actions[0]?.value).toBe('spex-approval-deadbeef');
    expect(result.interaction.response_url).toBe('https://hooks.slack.com/actions/abc');
  });

  it('returns unknown for non-block_actions interactive payloads', () => {
    const payload = { type: 'view_submission', view: {}, user: { id: 'U1' } };
    const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
    const result = parseSlackWebhookPayload(body);
    expect(result.kind).toBe('unknown');
    if (result.kind !== 'unknown') return;
    expect(result.reason).toContain('block_actions');
  });

  it('returns unknown for an empty form body', () => {
    const result = parseSlackWebhookPayload('foo=bar');
    expect(result.kind).toBe('unknown');
  });

  it('throws on empty body', () => {
    expect(() => parseSlackWebhookPayload('')).toThrow(InvalidSlackWebhookPayloadError);
  });

  it('throws on malformed JSON payload', () => {
    const body = new URLSearchParams({ payload: '{not-json' }).toString();
    expect(() => parseSlackWebhookPayload(body)).toThrow(InvalidSlackWebhookPayloadError);
  });
});
