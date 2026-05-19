import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it, vi } from 'vitest';
import { buildPostHogBugSource } from './bug-source.js';
import { POSTHOG_TOOLS } from './operations.js';
import type { PostHogMcpClient } from './types.js';

interface CallToolStub {
  callTool: ReturnType<typeof vi.fn>;
}

function makeClient(
  callTool: ReturnType<typeof vi.fn>,
  options: { projectId?: string } = {},
): PostHogMcpClient {
  const stub: CallToolStub = { callTool };
  return {
    client: stub as unknown as Client,
    endpoint: 'https://mcp.posthog.com/mcp',
    ...(options.projectId !== undefined
      ? { projectId: options.projectId }
      : { projectId: undefined }),
    close: async () => {},
  };
}

const issuePayload = {
  id: 'iss_abc123',
  name: 'TypeError: cannot read property "id" of undefined',
  description: 'Thrown from `renderInvoice` when invoice payload is missing line items.',
  url: 'https://app.posthog.com/project/336884/error_tracking/iss_abc123',
  status: 'active',
  firstSeen: '2026-05-15T12:34:56Z',
  lastSeen: '2026-05-19T08:12:30Z',
  occurrences: 142,
  affectedUsers: 37,
  stack: [
    {
      file: 'src/invoice/render.ts',
      function: 'renderInvoice',
      line: 88,
      column: 14,
      source: 'const id = invoice.lineItems[0].id;',
    },
    {
      file: 'src/handlers/invoice.ts',
      function: 'handleInvoicePost',
      line: 24,
      column: 9,
      source: null,
    },
  ],
};

const eventWithSessionPayload = {
  id: 'evt_1',
  event: '$exception',
  timestamp: '2026-05-19T08:12:30Z',
  distinctId: 'user_42',
  properties: {
    $session_id: 'sess_zzz1',
    $exception_issue_id: 'iss_abc123',
  },
};

describe('buildPostHogBugSource', () => {
  it('fetches the issue, queries events, and builds a description from both', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ content: [], structuredContent: issuePayload, isError: false })
      .mockResolvedValueOnce({
        content: [],
        structuredContent: { events: [eventWithSessionPayload] },
        isError: false,
      });
    const client = makeClient(callTool, { projectId: '336884' });

    const source = await buildPostHogBugSource({ client, issueId: 'iss_abc123' });

    expect(callTool).toHaveBeenNthCalledWith(1, {
      name: POSTHOG_TOOLS.getErrorIssue,
      arguments: { id: 'iss_abc123', projectId: '336884' },
    });
    expect(callTool.mock.calls[1]?.[0].name).toBe(POSTHOG_TOOLS.runQuery);
    expect(source.issue.id).toBe('iss_abc123');
    expect(source.firstOccurrence).toBe('2026-05-15T12:34:56Z');
    expect(source.errorMessage).toBe('TypeError: cannot read property "id" of undefined');
    expect(source.errorStack).toContain('renderInvoice');
    expect(source.errorStack).toContain('src/invoice/render.ts:88:14');
    expect(source.sessionRecordingUrls).toEqual([
      'https://app.posthog.com/project/336884/replay/sess_zzz1',
    ]);
    expect(source.description).toContain('occurrences=142');
    expect(source.description).toContain('affectedUsers=37');
    expect(source.description).toContain(issuePayload.url);
    expect(source.description).toContain('Session recordings:');
    expect(source.description).toContain('replay/sess_zzz1');
  });

  it('skips the events query when maxSessionRecordings is 0', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ content: [], structuredContent: issuePayload, isError: false });
    const client = makeClient(callTool, { projectId: '336884' });

    const source = await buildPostHogBugSource({
      client,
      issueId: 'iss_abc123',
      maxSessionRecordings: 0,
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(source.sessionRecordingUrls).toEqual([]);
    expect(source.description).not.toContain('Session recordings:');
  });

  it('falls back to no recordings if the events query rejects (e.g. unknown property)', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ content: [], structuredContent: issuePayload, isError: false })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'unknown property $exception_issue_id' }],
        isError: true,
      });
    const client = makeClient(callTool, { projectId: '336884' });

    const source = await buildPostHogBugSource({ client, issueId: 'iss_abc123' });
    expect(source.sessionRecordingUrls).toEqual([]);
    // Description should still include the rest of the issue context.
    expect(source.description).toContain('occurrences=142');
  });

  it('caps the recording list and deduplicates session ids', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ content: [], structuredContent: issuePayload, isError: false })
      .mockResolvedValueOnce({
        content: [],
        structuredContent: {
          events: [
            { ...eventWithSessionPayload, id: 'evt_1' },
            { ...eventWithSessionPayload, id: 'evt_2' },
            {
              ...eventWithSessionPayload,
              id: 'evt_3',
              properties: { $session_id: 'sess_two', $exception_issue_id: 'iss_abc123' },
            },
            {
              ...eventWithSessionPayload,
              id: 'evt_4',
              properties: { $session_id: 'sess_three', $exception_issue_id: 'iss_abc123' },
            },
            {
              ...eventWithSessionPayload,
              id: 'evt_5',
              properties: { $session_id: 'sess_four', $exception_issue_id: 'iss_abc123' },
            },
          ],
        },
        isError: false,
      });
    const client = makeClient(callTool, { projectId: '336884' });

    const source = await buildPostHogBugSource({
      client,
      issueId: 'iss_abc123',
      maxSessionRecordings: 2,
    });
    expect(source.sessionRecordingUrls).toEqual([
      'https://app.posthog.com/project/336884/replay/sess_zzz1',
      'https://app.posthog.com/project/336884/replay/sess_two',
    ]);
  });

  it('prefers an explicit $session_recording_url over a synthesized one', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ content: [], structuredContent: issuePayload, isError: false })
      .mockResolvedValueOnce({
        content: [],
        structuredContent: {
          events: [
            {
              id: 'evt_with_explicit',
              event: '$exception',
              timestamp: '2026-05-19T08:12:30Z',
              distinctId: 'user_42',
              properties: {
                $session_id: 'sess_zzz1',
                $exception_issue_id: 'iss_abc123',
                $session_recording_url: 'https://other.posthog.io/replay/sess_zzz1?token=xyz',
              },
            },
          ],
        },
        isError: false,
      });
    const client = makeClient(callTool, { projectId: '336884' });
    const source = await buildPostHogBugSource({ client, issueId: 'iss_abc123' });
    expect(source.sessionRecordingUrls).toEqual([
      'https://other.posthog.io/replay/sess_zzz1?token=xyz',
    ]);
  });

  it('drops recordings when no projectId is known and no explicit url is on the event', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ content: [], structuredContent: issuePayload, isError: false })
      .mockResolvedValueOnce({
        content: [],
        structuredContent: { events: [eventWithSessionPayload] },
        isError: false,
      });
    const client = makeClient(callTool); // projectId omitted

    const source = await buildPostHogBugSource({ client, issueId: 'iss_abc123' });
    expect(source.sessionRecordingUrls).toEqual([]);
  });

  it('escapes single quotes in the issue id when building the HogQL query', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ content: [], structuredContent: issuePayload, isError: false })
      .mockResolvedValueOnce({
        content: [],
        structuredContent: { events: [] },
        isError: false,
      });
    const client = makeClient(callTool, { projectId: '336884' });

    await buildPostHogBugSource({ client, issueId: "iss'a\\b" });

    const args = callTool.mock.calls[1]?.[0].arguments as Record<string, unknown>;
    const query = (args.query as { query: string }).query;
    expect(query).toContain("'iss\\'a\\\\b'");
  });

  it('omits stack section from description when issue has no stack frames', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({
        content: [],
        structuredContent: { ...issuePayload, stack: [] },
        isError: false,
      })
      .mockResolvedValueOnce({
        content: [],
        structuredContent: { events: [] },
        isError: false,
      });
    const client = makeClient(callTool, { projectId: '336884' });
    const source = await buildPostHogBugSource({ client, issueId: 'iss_abc123' });
    expect(source.description).not.toContain('Stack:');
    expect(source.errorStack).toBeUndefined();
  });
});
