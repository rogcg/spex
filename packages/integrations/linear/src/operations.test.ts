import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it, vi } from 'vitest';
import {
  LINEAR_TOOLS,
  LinearToolError,
  addLinearComment,
  createLinearIssue,
  getLinearIssue,
  listLinearIssues,
  updateLinearIssueStatus,
} from './operations.js';
import type { LinearMcpClient } from './types.js';

interface CallToolStub {
  callTool: ReturnType<typeof vi.fn>;
}

function makeClient(callTool: ReturnType<typeof vi.fn>): LinearMcpClient {
  const stub: CallToolStub = { callTool };
  return {
    client: stub as unknown as Client,
    endpoint: 'https://mcp.linear.app/mcp',
    close: async () => {},
  };
}

const sampleIssue = {
  id: 'iss_uuid_1',
  identifier: 'SPX-47',
  title: 'Linear MCP Client',
  description: 'Sprint 6 Step 1',
  url: 'https://linear.app/spex/issue/SPX-47',
  status: { id: 'st_progress', name: 'In Progress', type: 'started' },
  team: { id: 'team_uuid_spx', key: 'SPX', name: 'SPEX' },
  assignee: {
    id: 'user_uuid_1',
    name: 'rogcg',
    displayName: 'rogcg',
    email: 'rogcg@example.com',
  },
  labels: [{ id: 'lbl_1', name: 'sprint-6', color: '#ff0000' }],
  priority: 3,
  createdAt: '2026-05-17T19:53:13.169Z',
  updatedAt: '2026-05-19T04:13:31.285Z',
};

const sampleComment = {
  id: 'cmt_uuid_1',
  body: 'Looks good to me',
  url: 'https://linear.app/spex/issue/SPX-47#comment-1',
  createdAt: '2026-05-19T05:00:00.000Z',
  user: {
    id: 'user_uuid_1',
    name: 'rogcg',
    displayName: 'rogcg',
    email: 'rogcg@example.com',
  },
};

describe('getLinearIssue', () => {
  it('calls the get_issue tool with the issue id and parses structuredContent', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [], structuredContent: sampleIssue, isError: false });
    const client = makeClient(callTool);

    const issue = await getLinearIssue({ client, id: 'SPX-47' });

    expect(callTool).toHaveBeenCalledWith({
      name: LINEAR_TOOLS.getIssue,
      arguments: { id: 'SPX-47' },
    });
    expect(issue.identifier).toBe('SPX-47');
    expect(issue.status.type).toBe('started');
    expect(issue.assignee?.name).toBe('rogcg');
  });

  it('falls back to parsing JSON out of text content when structuredContent is absent', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(sampleIssue) }],
      isError: false,
    });
    const client = makeClient(callTool);
    const issue = await getLinearIssue({ client, id: 'SPX-47' });
    expect(issue.identifier).toBe('SPX-47');
  });

  it('throws LinearToolError when the server reports isError', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'issue not found: SPX-9999' }],
      isError: true,
    });
    const client = makeClient(callTool);
    await expect(getLinearIssue({ client, id: 'SPX-9999' })).rejects.toMatchObject({
      name: 'LinearToolError',
      message: expect.stringContaining('issue not found'),
    });
  });

  it('throws LinearToolError when the response does not match the schema', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [], structuredContent: { broken: true }, isError: false });
    const client = makeClient(callTool);
    await expect(getLinearIssue({ client, id: 'SPX-47' })).rejects.toBeInstanceOf(LinearToolError);
  });
});

describe('updateLinearIssueStatus', () => {
  it('forwards the new status as `state` to the update_issue tool', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ structuredContent: sampleIssue, content: [], isError: false });
    const client = makeClient(callTool);

    const issue = await updateLinearIssueStatus({ client, id: 'SPX-47', status: 'In Review' });

    expect(callTool).toHaveBeenCalledWith({
      name: LINEAR_TOOLS.updateIssue,
      arguments: { id: 'SPX-47', state: 'In Review' },
    });
    expect(issue.identifier).toBe('SPX-47');
  });
});

describe('createLinearIssue', () => {
  it('sends only team and title when description and labels are omitted', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ structuredContent: sampleIssue, content: [], isError: false });
    const client = makeClient(callTool);

    await createLinearIssue({ client, team: 'SPX', title: 'New thing' });

    expect(callTool).toHaveBeenCalledWith({
      name: LINEAR_TOOLS.createIssue,
      arguments: { team: 'SPX', title: 'New thing' },
    });
  });

  it('passes description and labels when supplied', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ structuredContent: sampleIssue, content: [], isError: false });
    const client = makeClient(callTool);

    await createLinearIssue({
      client,
      team: 'SPX',
      title: 'New thing',
      description: 'details here',
      labels: ['bug', 'priority:high'],
    });

    expect(callTool).toHaveBeenCalledWith({
      name: LINEAR_TOOLS.createIssue,
      arguments: {
        team: 'SPX',
        title: 'New thing',
        description: 'details here',
        labels: ['bug', 'priority:high'],
      },
    });
  });

  it('omits empty label arrays rather than sending labels: []', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ structuredContent: sampleIssue, content: [], isError: false });
    const client = makeClient(callTool);

    await createLinearIssue({ client, team: 'SPX', title: 'New thing', labels: [] });

    const args = callTool.mock.calls[0]?.[0].arguments as Record<string, unknown>;
    expect(args).not.toHaveProperty('labels');
  });
});

describe('addLinearComment', () => {
  it('sends issueId + body to the create_comment tool and parses the comment', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ structuredContent: sampleComment, content: [], isError: false });
    const client = makeClient(callTool);

    const comment = await addLinearComment({
      client,
      issueId: 'SPX-47',
      body: 'Looks good to me',
    });

    expect(callTool).toHaveBeenCalledWith({
      name: LINEAR_TOOLS.createComment,
      arguments: { issueId: 'SPX-47', body: 'Looks good to me' },
    });
    expect(comment.body).toBe('Looks good to me');
    expect(comment.user?.name).toBe('rogcg');
  });
});

describe('listLinearIssues', () => {
  it('sends only team when no filters are supplied', async () => {
    const callTool = vi.fn().mockResolvedValue({
      structuredContent: { issues: [sampleIssue, sampleIssue] },
      content: [],
      isError: false,
    });
    const client = makeClient(callTool);

    const issues = await listLinearIssues({ client, team: 'SPX' });

    expect(callTool).toHaveBeenCalledWith({
      name: LINEAR_TOOLS.listIssues,
      arguments: { team: 'SPX' },
    });
    expect(issues).toHaveLength(2);
  });

  it('forwards states, labels, assignee, and limit when provided', async () => {
    const callTool = vi.fn().mockResolvedValue({
      structuredContent: { issues: [] },
      content: [],
      isError: false,
    });
    const client = makeClient(callTool);

    await listLinearIssues({
      client,
      team: 'SPX',
      states: ['In Progress', 'In Review'],
      labels: ['bug'],
      assignee: 'me',
      limit: 25,
    });

    expect(callTool).toHaveBeenCalledWith({
      name: LINEAR_TOOLS.listIssues,
      arguments: {
        team: 'SPX',
        states: ['In Progress', 'In Review'],
        labels: ['bug'],
        assignee: 'me',
        limit: 25,
      },
    });
  });

  it('omits empty arrays from the request', async () => {
    const callTool = vi.fn().mockResolvedValue({
      structuredContent: { issues: [] },
      content: [],
      isError: false,
    });
    const client = makeClient(callTool);

    await listLinearIssues({ client, team: 'SPX', states: [], labels: [] });

    const args = callTool.mock.calls[0]?.[0].arguments as Record<string, unknown>;
    expect(args).not.toHaveProperty('states');
    expect(args).not.toHaveProperty('labels');
  });
});
