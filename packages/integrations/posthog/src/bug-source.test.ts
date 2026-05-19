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
  _posthogUrl: 'https://us.posthog.com/project/431680/error_tracking/iss_abc123',
  status: 'active',
  first_seen: '2026-05-15T12:34:56Z',
  last_seen: '2026-05-19T08:12:30Z',
  aggregations: { occurrences: 142, users: 37, sessions: 41 },
  latestEvent: {
    stack: [
      {
        filename: 'src/invoice/render.ts',
        function: 'renderInvoice',
        lineno: 88,
        colno: 14,
        context_line: 'const id = invoice.lineItems[0].id;',
      },
      {
        filename: 'src/handlers/invoice.ts',
        function: 'handleInvoicePost',
        lineno: 24,
        colno: 9,
      },
    ],
  },
};

const eventWithSessionPayload = {
  uuid: 'evt_1',
  event: '$exception',
  timestamp: '2026-05-19T08:12:30Z',
  distinct_id: 'user_42',
  properties: {
    $session_id: 'sess_zzz1',
    $exception_issue_id: 'iss_abc123',
  },
};

describe('buildPostHogBugSource', () => {
  it('fetches the issue, fetches issue events, and builds a description from both', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ content: [], structuredContent: issuePayload, isError: false })
      .mockResolvedValueOnce({
        content: [],
        structuredContent: { events: [eventWithSessionPayload] },
        isError: false,
      });
    const client = makeClient(callTool, { projectId: '431680' });

    const source = await buildPostHogBugSource({ client, issueId: 'iss_abc123' });

    expect(callTool.mock.calls[0]?.[0].name).toBe(POSTHOG_TOOLS.getErrorIssue);
    expect(callTool.mock.calls[1]?.[0].name).toBe(POSTHOG_TOOLS.errorIssueEvents);
    expect(source.issue.id).toBe('iss_abc123');
    expect(source.firstOccurrence).toBe('2026-05-15T12:34:56Z');
    expect(source.errorMessage).toBe('TypeError: cannot read property "id" of undefined');
    expect(source.errorStack).toContain('renderInvoice');
    expect(source.errorStack).toContain('src/invoice/render.ts:88:14');
    expect(source.sessionRecordingUrls).toEqual([
      'https://us.posthog.com/project/431680/replay/sess_zzz1',
    ]);
    expect(source.description).toContain('occurrences=142');
    expect(source.description).toContain('affectedUsers=37');
    expect(source.description).toContain(issuePayload._posthogUrl);
    expect(source.description).toContain('Session recordings:');
    expect(source.description).toContain('replay/sess_zzz1');
  });

  it('skips the events call when maxSessionRecordings is 0', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ content: [], structuredContent: issuePayload, isError: false });
    const client = makeClient(callTool, { projectId: '431680' });

    const source = await buildPostHogBugSource({
      client,
      issueId: 'iss_abc123',
      maxSessionRecordings: 0,
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(source.sessionRecordingUrls).toEqual([]);
    expect(source.description).not.toContain('Session recordings:');
  });

  it('falls back to no recordings if the events call rejects', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ content: [], structuredContent: issuePayload, isError: false })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'unknown error' }],
        isError: true,
      });
    const client = makeClient(callTool, { projectId: '431680' });

    const source = await buildPostHogBugSource({ client, issueId: 'iss_abc123' });
    expect(source.sessionRecordingUrls).toEqual([]);
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
            { ...eventWithSessionPayload, uuid: 'evt_1' },
            { ...eventWithSessionPayload, uuid: 'evt_2' },
            {
              ...eventWithSessionPayload,
              uuid: 'evt_3',
              properties: { $session_id: 'sess_two', $exception_issue_id: 'iss_abc123' },
            },
            {
              ...eventWithSessionPayload,
              uuid: 'evt_4',
              properties: { $session_id: 'sess_three', $exception_issue_id: 'iss_abc123' },
            },
            {
              ...eventWithSessionPayload,
              uuid: 'evt_5',
              properties: { $session_id: 'sess_four', $exception_issue_id: 'iss_abc123' },
            },
          ],
        },
        isError: false,
      });
    const client = makeClient(callTool, { projectId: '431680' });

    const source = await buildPostHogBugSource({
      client,
      issueId: 'iss_abc123',
      maxSessionRecordings: 2,
    });
    expect(source.sessionRecordingUrls).toEqual([
      'https://us.posthog.com/project/431680/replay/sess_zzz1',
      'https://us.posthog.com/project/431680/replay/sess_two',
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
              uuid: 'evt_with_explicit',
              event: '$exception',
              timestamp: '2026-05-19T08:12:30Z',
              distinct_id: 'user_42',
              properties: {
                $session_id: 'sess_zzz1',
                $exception_issue_id: 'iss_abc123',
                $session_recording_url:
                  'https://other.posthog.io/replay/sess_zzz1?token=xyz',
              },
            },
          ],
        },
        isError: false,
      });
    const client = makeClient(callTool, { projectId: '431680' });
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

  it('omits stack section from description when issue has no stack frames', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({
        content: [],
        structuredContent: { ...issuePayload, latestEvent: { stack: [] } },
        isError: false,
      })
      .mockResolvedValueOnce({
        content: [],
        structuredContent: { events: [] },
        isError: false,
      });
    const client = makeClient(callTool, { projectId: '431680' });
    const source = await buildPostHogBugSource({ client, issueId: 'iss_abc123' });
    expect(source.description).not.toContain('Stack:');
    expect(source.errorStack).toBeUndefined();
  });
});
