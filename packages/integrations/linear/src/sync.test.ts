import type { LinearStatusMapping } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import { LINEAR_TOOLS } from './operations.js';
import {
  extractLinearId,
  extractLinearIdFromBranch,
  extractLinearIdFromPrBody,
  syncPrEventToLinear,
} from './sync.js';
import type { LinearMcpClient } from './types.js';

const DEFAULT_MAPPING: LinearStatusMapping = {
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  todo: 'Todo',
};

function makeClient(callTool: ReturnType<typeof vi.fn>): LinearMcpClient {
  return {
    client: { callTool } as unknown as LinearMcpClient['client'],
    endpoint: 'https://mcp.linear.app/mcp',
    close: async () => {},
  };
}

const issueResponse = {
  id: 'iss_1',
  identifier: 'SPX-47',
  title: 'Linear MCP Client',
  description: null,
  url: 'https://linear.app/spex/issue/SPX-47',
  status: { id: 's', name: 'In Review', type: 'started' },
  team: { id: 't', key: 'SPX', name: 'SPEX' },
  assignee: null,
  labels: [],
  priority: 3,
  createdAt: '2026-05-19T00:00:00Z',
  updatedAt: '2026-05-19T00:00:00Z',
};

const commentResponse = {
  id: 'cmt_1',
  body: 'SPEX: linked PR ...',
  url: 'https://linear.app/spex/issue/SPX-47#comment-1',
  createdAt: '2026-05-19T00:00:00Z',
  user: null,
};

describe('extractLinearIdFromPrBody', () => {
  it('matches a "Closes SPX-47" line', () => {
    expect(extractLinearIdFromPrBody('Closes SPX-47')).toBe('SPX-47');
  });

  it('matches a markdown link form "Closes [SPX-47](url)"', () => {
    expect(extractLinearIdFromPrBody('Closes [SPX-47](https://linear.app/spex/issue/SPX-47)')).toBe(
      'SPX-47',
    );
  });

  it('matches case-insensitively for the verb but preserves the identifier case', () => {
    expect(extractLinearIdFromPrBody('closes SPX-47')).toBe('SPX-47');
    expect(extractLinearIdFromPrBody('CLOSES SPX-47')).toBe('SPX-47');
  });

  it('falls back to the first bare identifier when no Closes line exists', () => {
    expect(extractLinearIdFromPrBody('See ENG-12 for context. Related: SPX-47.')).toBe('ENG-12');
  });

  it('returns null when no identifier is present', () => {
    expect(extractLinearIdFromPrBody('Refactor only — no ticket')).toBeNull();
  });

  it('ignores lowercase identifiers', () => {
    expect(extractLinearIdFromPrBody('see spx-47 maybe')).toBeNull();
  });
});

describe('extractLinearIdFromBranch', () => {
  it('uppercases lowercase team prefixes', () => {
    expect(extractLinearIdFromBranch('admin/spx-47-linear-mcp-client')).toBe('SPX-47');
  });

  it('handles plain `SPX-47` branches', () => {
    expect(extractLinearIdFromBranch('SPX-47')).toBe('SPX-47');
  });

  it('returns null when no identifier is found', () => {
    expect(extractLinearIdFromBranch('main')).toBeNull();
  });
});

describe('extractLinearId', () => {
  it('prefers the body over the branch', () => {
    expect(
      extractLinearId({
        prBody: 'Closes SPX-47',
        branch: 'admin/eng-12-other',
      }),
    ).toBe('SPX-47');
  });

  it('falls back to the branch when body has no identifier', () => {
    expect(
      extractLinearId({
        prBody: 'No ticket here',
        branch: 'admin/spx-47-thing',
      }),
    ).toBe('SPX-47');
  });

  it('returns null when neither source has an identifier', () => {
    expect(extractLinearId({ prBody: 'nothing', branch: 'main' })).toBeNull();
  });

  it('handles missing inputs gracefully', () => {
    expect(extractLinearId({})).toBeNull();
    expect(extractLinearId({ prBody: null, branch: null })).toBeNull();
  });
});

describe('syncPrEventToLinear', () => {
  it('opened → In Review (no comment)', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ structuredContent: issueResponse, content: [], isError: false });
    const client = makeClient(callTool);

    const result = await syncPrEventToLinear({
      client,
      linearId: 'SPX-47',
      event: { kind: 'opened', prNumber: 12, prUrl: 'https://github.com/x/y/pull/12' },
      statusMapping: DEFAULT_MAPPING,
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith({
      name: LINEAR_TOOLS.updateIssue,
      arguments: { id: 'SPX-47', state: 'In Review' },
    });
    expect(result.issue.identifier).toBe('SPX-47');
    expect(result.comment).toBeNull();
  });

  it('merged → Done (no comment)', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ structuredContent: issueResponse, content: [], isError: false });
    const client = makeClient(callTool);

    const result = await syncPrEventToLinear({
      client,
      linearId: 'SPX-47',
      event: { kind: 'merged', prNumber: 12, prUrl: 'https://github.com/x/y/pull/12' },
      statusMapping: DEFAULT_MAPPING,
    });

    expect(callTool).toHaveBeenCalledWith({
      name: LINEAR_TOOLS.updateIssue,
      arguments: { id: 'SPX-47', state: 'Done' },
    });
    expect(result.comment).toBeNull();
  });

  it('closed_unmerged → Todo + comment by default', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ structuredContent: issueResponse, content: [], isError: false })
      .mockResolvedValueOnce({ structuredContent: commentResponse, content: [], isError: false });
    const client = makeClient(callTool);

    const result = await syncPrEventToLinear({
      client,
      linearId: 'SPX-47',
      event: { kind: 'closed_unmerged', prNumber: 12, prUrl: 'https://github.com/x/y/pull/12' },
      statusMapping: DEFAULT_MAPPING,
    });

    expect(callTool).toHaveBeenNthCalledWith(1, {
      name: LINEAR_TOOLS.updateIssue,
      arguments: { id: 'SPX-47', state: 'Todo' },
    });
    expect(callTool).toHaveBeenNthCalledWith(2, {
      name: LINEAR_TOOLS.createComment,
      arguments: {
        issueId: 'SPX-47',
        body: expect.stringContaining(
          'linked PR [#12](https://github.com/x/y/pull/12) was closed without merging',
        ),
      },
    });
    expect(result.comment?.id).toBe('cmt_1');
  });

  it('closed_unmerged → Todo without comment when commentOnUnmergedClose=false', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ structuredContent: issueResponse, content: [], isError: false });
    const client = makeClient(callTool);

    const result = await syncPrEventToLinear({
      client,
      linearId: 'SPX-47',
      event: { kind: 'closed_unmerged', prNumber: 12, prUrl: 'https://github.com/x/y/pull/12' },
      statusMapping: DEFAULT_MAPPING,
      commentOnUnmergedClose: false,
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(result.comment).toBeNull();
  });

  it('honours custom status mappings', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ structuredContent: issueResponse, content: [], isError: false });
    const client = makeClient(callTool);

    await syncPrEventToLinear({
      client,
      linearId: 'SPX-47',
      event: { kind: 'merged', prNumber: 12, prUrl: 'https://github.com/x/y/pull/12' },
      statusMapping: {
        in_progress: 'Working',
        in_review: 'Code Review',
        done: 'Shipped',
        todo: 'Backlog',
      },
    });

    expect(callTool).toHaveBeenCalledWith({
      name: LINEAR_TOOLS.updateIssue,
      arguments: { id: 'SPX-47', state: 'Shipped' },
    });
  });
});
