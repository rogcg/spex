import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOOL_CONTEXT,
  POSTHOG_TOOLS,
  PostHogToolError,
  getErrorIssue,
  getIssueEvents,
  getSessionRecording,
  queryEvents,
} from './operations.js';
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

// Fixture matching the real PostHog `query-error-tracking-issue` response.
const sampleIssue = {
  id: 'iss_abc123',
  name: 'TypeError: cannot read property "id" of undefined',
  description: 'Thrown from `renderInvoice` when invoice payload is missing line items.',
  _posthogUrl: 'https://us.posthog.com/project/431680/error_tracking/iss_abc123',
  status: 'active',
  first_seen: '2026-05-15T12:34:56Z',
  last_seen: '2026-05-19T08:12:30Z',
  aggregations: {
    occurrences: 142,
    users: 37,
    sessions: 41,
  },
  latestEvent: {
    topFrame: {
      filename: 'src/invoice/render.ts',
      function: 'renderInvoice',
      lineno: 88,
      colno: 14,
      context_line: 'const id = invoice.lineItems[0].id;',
    },
  },
};

const sampleSessionRecording = {
  id: 'rec_xyz789',
  _posthogUrl: 'https://us.posthog.com/project/431680/replay/rec_xyz789',
  start_time: '2026-05-19T08:11:00Z',
  end_time: '2026-05-19T08:13:42Z',
  recording_duration: 162,
  distinct_id: 'user_42',
  click_count: 14,
  pageview_count: 3,
};

const sampleEvent = {
  uuid: 'evt_111',
  event: '$exception',
  timestamp: '2026-05-19T08:12:30Z',
  distinct_id: 'user_42',
  properties: { $exception_type: 'TypeError', $session_id: 'sess_zzz1' },
};

describe('getErrorIssue', () => {
  it('calls query-error-tracking-issue with issueId + the required context string', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [], structuredContent: sampleIssue, isError: false });
    const client = makeClient(callTool);

    const issue = await getErrorIssue({ client, id: 'iss_abc123' });

    expect(callTool).toHaveBeenCalledWith({
      name: POSTHOG_TOOLS.getErrorIssue,
      arguments: { issueId: 'iss_abc123', context: DEFAULT_TOOL_CONTEXT },
    });
    expect(issue.id).toBe('iss_abc123');
    expect(issue.occurrences).toBe(142);
    expect(issue.affectedUsers).toBe(37);
    expect(issue.status).toBe('active');
    expect(issue.url).toBe('https://us.posthog.com/project/431680/error_tracking/iss_abc123');
    expect(issue.firstSeen).toBe('2026-05-15T12:34:56Z');
    expect(issue.lastSeen).toBe('2026-05-19T08:12:30Z');
    expect(issue.stack).toHaveLength(1);
    expect(issue.stack[0]?.function).toBe('renderInvoice');
    expect(issue.stack[0]?.file).toBe('src/invoice/render.ts');
    expect(issue.stack[0]?.line).toBe(88);
    expect(issue.stack[0]?.column).toBe(14);
  });

  it('forwards a dateFrom override into the dateRange envelope', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [], structuredContent: sampleIssue, isError: false });
    const client = makeClient(callTool);

    await getErrorIssue({ client, id: 'iss_abc123', dateFrom: '-30d' });

    expect(callTool).toHaveBeenCalledWith({
      name: POSTHOG_TOOLS.getErrorIssue,
      arguments: {
        issueId: 'iss_abc123',
        context: DEFAULT_TOOL_CONTEXT,
        dateRange: { date_from: '-30d' },
      },
    });
  });

  it('allows a custom context to override the default', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [], structuredContent: sampleIssue, isError: false });
    const client = makeClient(callTool);

    await getErrorIssue({
      client,
      id: 'iss_abc123',
      context:
        'SPEX integration smoke test verifies error issue fetch end to end against the live PostHog MCP server.',
    });

    const args = callTool.mock.calls[0]?.[0].arguments as Record<string, unknown>;
    expect(args.context).toContain('integration smoke test');
  });

  it('falls back to parsing JSON out of text content when structuredContent is absent', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(sampleIssue) }],
      isError: false,
    });
    const client = makeClient(callTool);
    const issue = await getErrorIssue({ client, id: 'iss_abc123' });
    expect(issue.id).toBe('iss_abc123');
  });

  it('coerces stringified numeric counts inside the aggregations block', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: {
        ...sampleIssue,
        aggregations: { occurrences: '5012', users: '88', sessions: '100' },
      },
      isError: false,
    });
    const client = makeClient(callTool);
    const issue = await getErrorIssue({ client, id: 'iss_abc123' });
    expect(issue.occurrences).toBe(5012);
    expect(issue.affectedUsers).toBe(88);
  });

  it('falls back to top-level occurrences/users when no aggregations block is present', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: {
        ...sampleIssue,
        aggregations: undefined,
        occurrences: 7,
        users: 3,
      },
      isError: false,
    });
    const client = makeClient(callTool);
    const issue = await getErrorIssue({ client, id: 'iss_abc123' });
    expect(issue.occurrences).toBe(7);
    expect(issue.affectedUsers).toBe(3);
  });

  it('reads a stack array from latestEvent.stack when topFrame is absent', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: {
        ...sampleIssue,
        latestEvent: {
          stack: [
            { filename: 'a.ts', function: 'a', lineno: 1, colno: 2 },
            { filename: 'b.ts', function: 'b', lineno: 3, colno: 4 },
          ],
        },
      },
      isError: false,
    });
    const client = makeClient(callTool);
    const issue = await getErrorIssue({ client, id: 'iss_abc123' });
    expect(issue.stack).toHaveLength(2);
    expect(issue.stack[0]?.function).toBe('a');
    expect(issue.stack[1]?.function).toBe('b');
  });

  it('treats `pending_release` status as still-active for the bug-fix pipeline', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: { ...sampleIssue, status: 'pending_release' },
      isError: false,
    });
    const client = makeClient(callTool);
    const issue = await getErrorIssue({ client, id: 'iss_abc123' });
    expect(issue.status).toBe('active');
  });

  it('throws PostHogToolError when the server reports isError', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'issue not found: iss_missing' }],
      isError: true,
    });
    const client = makeClient(callTool);
    await expect(getErrorIssue({ client, id: 'iss_missing' })).rejects.toMatchObject({
      name: 'PostHogToolError',
      message: expect.stringContaining('issue not found'),
    });
  });

  it('throws PostHogToolError when the response is missing the issue id', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [], structuredContent: { unrelated: true }, isError: false });
    const client = makeClient(callTool);
    await expect(getErrorIssue({ client, id: 'iss_abc123' })).rejects.toBeInstanceOf(
      PostHogToolError,
    );
  });
});

describe('getIssueEvents', () => {
  it('calls query-error-tracking-issue-events with the issueId, verbosity=stack, limit, and context defaults', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: { events: [sampleEvent] },
      isError: false,
    });
    const client = makeClient(callTool);

    const events = await getIssueEvents({ client, issueId: 'iss_abc123' });

    expect(callTool).toHaveBeenCalledWith({
      name: POSTHOG_TOOLS.errorIssueEvents,
      arguments: {
        issueId: 'iss_abc123',
        verbosity: 'stack',
        limit: 5,
        context: DEFAULT_TOOL_CONTEXT,
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('$exception');
    expect(events[0]?.distinctId).toBe('user_42');
    expect(events[0]?.properties.$session_id).toBe('sess_zzz1');
  });

  it('accepts the older `{results: [...]}` shape', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: { results: [sampleEvent, sampleEvent] },
      isError: false,
    });
    const client = makeClient(callTool);
    const events = await getIssueEvents({ client, issueId: 'iss_abc123' });
    expect(events).toHaveLength(2);
  });

  it('forwards dateFrom + verbosity overrides into the call arguments', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: { events: [] },
      isError: false,
    });
    const client = makeClient(callTool);

    await getIssueEvents({
      client,
      issueId: 'iss_abc123',
      dateFrom: '-90d',
      verbosity: 'raw',
      limit: 12,
    });

    expect(callTool).toHaveBeenCalledWith({
      name: POSTHOG_TOOLS.errorIssueEvents,
      arguments: {
        issueId: 'iss_abc123',
        verbosity: 'raw',
        limit: 12,
        context: DEFAULT_TOOL_CONTEXT,
        dateRange: { date_from: '-90d' },
      },
    });
  });
});

describe('queryEvents', () => {
  it('sends the SQL string directly to execute-sql (no envelope) along with the context', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: {
        columns: ['uuid', 'event', 'timestamp', 'distinct_id', 'properties'],
        results: [['evt_1', '$exception', '2026-05-19T08:12:30Z', 'user_42', { x: 1 }]],
      },
      isError: false,
    });
    const client = makeClient(callTool);

    const events = await queryEvents({
      client,
      query:
        "SELECT * FROM events WHERE event = '$exception' AND timestamp > now() - INTERVAL 1 DAY LIMIT 10",
    });

    expect(callTool).toHaveBeenCalledWith({
      name: POSTHOG_TOOLS.executeSql,
      arguments: {
        query:
          "SELECT * FROM events WHERE event = '$exception' AND timestamp > now() - INTERVAL 1 DAY LIMIT 10",
        context: DEFAULT_TOOL_CONTEXT,
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('$exception');
    expect(events[0]?.id).toBe('evt_1');
    expect(events[0]?.distinctId).toBe('user_42');
  });

  it('forwards truncate=false when supplied', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: { columns: [], results: [] },
      isError: false,
    });
    const client = makeClient(callTool);

    await queryEvents({ client, query: 'SELECT 1', truncate: false });

    const args = callTool.mock.calls[0]?.[0].arguments as Record<string, unknown>;
    expect(args.truncate).toBe(false);
  });

  it('handles the newer `{events: [...]}` response shape as well', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: { events: [sampleEvent, sampleEvent] },
      isError: false,
    });
    const client = makeClient(callTool);
    const events = await queryEvents({ client, query: 'SELECT * FROM events LIMIT 2' });
    expect(events).toHaveLength(2);
  });
});

describe('getSessionRecording', () => {
  it('calls session-recording-get with the id and required context', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [], structuredContent: sampleSessionRecording, isError: false });
    const client = makeClient(callTool);

    const recording = await getSessionRecording({ client, id: 'rec_xyz789' });

    expect(callTool).toHaveBeenCalledWith({
      name: POSTHOG_TOOLS.getSessionRecording,
      arguments: { id: 'rec_xyz789', context: DEFAULT_TOOL_CONTEXT },
    });
    expect(recording.id).toBe('rec_xyz789');
    expect(recording.durationSeconds).toBe(162);
    expect(recording.distinctId).toBe('user_42');
    expect(recording.url).toBe('https://us.posthog.com/project/431680/replay/rec_xyz789');
  });

  it('accepts null counters from PostHog', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: {
        ...sampleSessionRecording,
        end_time: null,
        recording_duration: null,
        click_count: null,
        pageview_count: null,
      },
      isError: false,
    });
    const client = makeClient(callTool);
    const recording = await getSessionRecording({ client, id: 'rec_xyz789' });
    expect(recording.endTime).toBeNull();
    expect(recording.durationSeconds).toBeNull();
    expect(recording.clickCount).toBeNull();
    expect(recording.pageviewCount).toBeNull();
  });
});
