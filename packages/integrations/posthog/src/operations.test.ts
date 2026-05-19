import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it, vi } from 'vitest';
import {
  POSTHOG_TOOLS,
  PostHogToolError,
  getErrorIssue,
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

const sampleErrorIssue = {
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

const sampleSessionRecording = {
  id: 'rec_xyz789',
  url: 'https://app.posthog.com/project/336884/replay/rec_xyz789',
  startTime: '2026-05-19T08:11:00Z',
  endTime: '2026-05-19T08:13:42Z',
  durationSeconds: 162,
  distinctId: 'user_42',
  clickCount: 14,
  pageviewCount: 3,
};

const sampleEvent = {
  id: 'evt_111',
  event: '$exception',
  timestamp: '2026-05-19T08:12:30Z',
  distinctId: 'user_42',
  properties: { $exception_type: 'TypeError', invoiceId: 'inv_99' },
};

describe('getErrorIssue', () => {
  it('calls the get-error-issue tool with the issue id and parses structuredContent', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [], structuredContent: sampleErrorIssue, isError: false });
    const client = makeClient(callTool);

    const issue = await getErrorIssue({ client, id: 'iss_abc123' });

    expect(callTool).toHaveBeenCalledWith({
      name: POSTHOG_TOOLS.getErrorIssue,
      arguments: { id: 'iss_abc123' },
    });
    expect(issue.id).toBe('iss_abc123');
    expect(issue.occurrences).toBe(142);
    expect(issue.affectedUsers).toBe(37);
    expect(issue.status).toBe('active');
    expect(issue.stack).toHaveLength(2);
    expect(issue.stack[0]?.function).toBe('renderInvoice');
  });

  it('forwards projectId from the client when configured', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [], structuredContent: sampleErrorIssue, isError: false });
    const client = makeClient(callTool, { projectId: '336884' });

    await getErrorIssue({ client, id: 'iss_abc123' });

    expect(callTool).toHaveBeenCalledWith({
      name: POSTHOG_TOOLS.getErrorIssue,
      arguments: { id: 'iss_abc123', projectId: '336884' },
    });
  });

  it('falls back to parsing JSON out of text content when structuredContent is absent', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(sampleErrorIssue) }],
      isError: false,
    });
    const client = makeClient(callTool);
    const issue = await getErrorIssue({ client, id: 'iss_abc123' });
    expect(issue.id).toBe('iss_abc123');
  });

  it('coerces stringified numeric counts to numbers', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: {
        ...sampleErrorIssue,
        occurrences: '5012',
        affectedUsers: '88',
      },
      isError: false,
    });
    const client = makeClient(callTool);
    const issue = await getErrorIssue({ client, id: 'iss_abc123' });
    expect(issue.occurrences).toBe(5012);
    expect(issue.affectedUsers).toBe(88);
  });

  it('accepts a stack arriving as `{frames: [...]}` and unwraps it', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: {
        ...sampleErrorIssue,
        stack: { frames: sampleErrorIssue.stack },
      },
      isError: false,
    });
    const client = makeClient(callTool);
    const issue = await getErrorIssue({ client, id: 'iss_abc123' });
    expect(issue.stack).toHaveLength(2);
    expect(issue.stack[0]?.function).toBe('renderInvoice');
  });

  it('treats a missing stack field as an empty array', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: { ...sampleErrorIssue, stack: undefined },
      isError: false,
    });
    const client = makeClient(callTool);
    const issue = await getErrorIssue({ client, id: 'iss_abc123' });
    expect(issue.stack).toEqual([]);
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

  it('throws PostHogToolError when the response does not match the schema', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [], structuredContent: { broken: true }, isError: false });
    const client = makeClient(callTool);
    await expect(getErrorIssue({ client, id: 'iss_abc123' })).rejects.toBeInstanceOf(
      PostHogToolError,
    );
  });
});

describe('queryEvents', () => {
  it('wraps the HogQL string in a query envelope and calls query-run', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: { events: [sampleEvent] },
      isError: false,
    });
    const client = makeClient(callTool);

    const events = await queryEvents({
      client,
      query: "SELECT * FROM events WHERE event = '$exception' LIMIT 10",
    });

    expect(callTool).toHaveBeenCalledWith({
      name: POSTHOG_TOOLS.runQuery,
      arguments: {
        query: {
          kind: 'HogQLQuery',
          query: "SELECT * FROM events WHERE event = '$exception' LIMIT 10",
        },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('$exception');
    expect(events[0]?.properties.invoiceId).toBe('inv_99');
  });

  it('accepts a `{results: [...]}` payload (PostHog query alias) and projects to events', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: { results: [sampleEvent, sampleEvent] },
      isError: false,
    });
    const client = makeClient(callTool);
    const events = await queryEvents({ client, query: 'SELECT * FROM events' });
    expect(events).toHaveLength(2);
  });

  it('forwards limit when supplied', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: { events: [] },
      isError: false,
    });
    const client = makeClient(callTool);

    await queryEvents({ client, query: 'SELECT * FROM events', limit: 25 });

    const args = callTool.mock.calls[0]?.[0].arguments as Record<string, unknown>;
    expect(args).toMatchObject({
      query: { kind: 'HogQLQuery', query: 'SELECT * FROM events' },
      limit: 25,
    });
  });

  it('forwards projectId when the client is scoped', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: { events: [] },
      isError: false,
    });
    const client = makeClient(callTool, { projectId: '336884' });

    await queryEvents({ client, query: 'SELECT * FROM events' });

    const args = callTool.mock.calls[0]?.[0].arguments as Record<string, unknown>;
    expect(args.projectId).toBe('336884');
  });
});

describe('getSessionRecording', () => {
  it('calls the session-recording-get tool with the id and parses the recording', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: sampleSessionRecording,
      isError: false,
    });
    const client = makeClient(callTool);

    const recording = await getSessionRecording({ client, id: 'rec_xyz789' });

    expect(callTool).toHaveBeenCalledWith({
      name: POSTHOG_TOOLS.getSessionRecording,
      arguments: { id: 'rec_xyz789' },
    });
    expect(recording.id).toBe('rec_xyz789');
    expect(recording.durationSeconds).toBe(162);
    expect(recording.distinctId).toBe('user_42');
  });

  it('treats a missing endTime / null counters as null', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [],
      structuredContent: {
        ...sampleSessionRecording,
        endTime: null,
        durationSeconds: null,
        clickCount: null,
        pageviewCount: null,
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
