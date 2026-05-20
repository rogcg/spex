import { describe, expect, it, vi } from 'vitest';
import {
  type SlackChannelMap,
  SlackEphemeralPostError,
  notifyFixProposed,
  notifyPrOpened,
  notifyReviewComplete,
  notifySpecGenerated,
  postToResponseUrl,
} from './notifications.js';

function mockClient(opts?: { fail?: boolean }) {
  const postMessage = opts?.fail
    ? vi.fn(async () => {
        throw new Error('slack down');
      })
    : vi.fn(async ({ channel }: { channel: string }) => ({ ok: true, ts: '1.2', channel }));
  return {
    chat: { postMessage },
  } as unknown as import('@slack/web-api').WebClient;
}

describe('notification dispatchers', () => {
  it('routes pr_opened to channels.pr_opened first, falling back to default', async () => {
    const client = mockClient();
    const channels: SlackChannelMap = { pr_opened: 'C_PRS', default: 'C_DEFAULT' };
    const result = await notifyPrOpened({
      client,
      channels,
      input: {
        branch: 'feature/x',
        title: 't',
        prUrl: 'https://x',
        repo: 'foo/bar',
        source: 'implement',
      },
    });
    expect(result.kind).toBe('sent');
    if (result.kind !== 'sent') return;
    expect(result.channelId).toBe('C_PRS');
  });

  it('falls back to default channel when the specific channel is unset', async () => {
    const client = mockClient();
    const result = await notifyFixProposed({
      client,
      channels: { default: 'C_DEFAULT' },
      input: {
        title: 't',
        hypothesis: 'h',
        filesAffected: [],
        origin: 'manual',
        correlationId: 'spex-approval-x',
      },
    });
    expect(result.kind).toBe('sent');
    if (result.kind !== 'sent') return;
    expect(result.channelId).toBe('C_DEFAULT');
  });

  it('returns skipped_no_channel when no channel resolves', async () => {
    const client = mockClient();
    const result = await notifySpecGenerated({
      client,
      channels: {},
      input: { title: 't', slug: 's', summary: 'x', acceptanceCriteria: [] },
    });
    expect(result.kind).toBe('skipped_no_channel');
  });

  it('honours channelOverride for slash-command style replies', async () => {
    const client = mockClient();
    const result = await notifyReviewComplete({
      client,
      channels: { review_complete: 'C_REVIEWS' },
      channelOverride: 'C_INVOKER',
      input: {
        prNumber: 1,
        prTitle: 't',
        prUrl: 'https://x',
        repo: 'foo/bar',
        verdict: 'approve',
        findingCount: 0,
        topFindings: [],
      },
    });
    expect(result.kind).toBe('sent');
    if (result.kind !== 'sent') return;
    expect(result.channelId).toBe('C_INVOKER');
  });

  it('returns error variant when Slack call throws', async () => {
    const client = mockClient({ fail: true });
    const result = await notifyPrOpened({
      client,
      channels: { default: 'C_X' },
      input: {
        branch: 'b',
        title: 't',
        prUrl: 'https://x',
        repo: 'foo/bar',
        source: 'implement',
      },
    });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.error).toContain('slack down');
  });
});

describe('postToResponseUrl', () => {
  it('POSTs the message JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    await postToResponseUrl({
      responseUrl: 'https://hooks.slack.com/x',
      message: { text: 'hi', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }] },
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const call = calls[0];
    if (call === undefined) throw new Error('expected fetchImpl to be called');
    const init = call[1];
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.text).toBe('hi');
    expect(body.response_type).toBe('ephemeral');
  });

  it('throws SlackEphemeralPostError on non-2xx', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 410 }));
    await expect(
      postToResponseUrl({
        responseUrl: 'https://hooks.slack.com/x',
        message: { text: 'hi', blocks: [] },
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(SlackEphemeralPostError);
  });
});
