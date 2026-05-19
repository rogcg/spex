import { describe, expect, it, vi } from 'vitest';
import type { GitHubClient } from '../client.js';
import {
  commentOnPullRequest,
  createPullRequest,
  listPullRequests,
  readPullRequest,
  readPullRequestDiff,
} from './prs.js';

interface PrStubs {
  create?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
  list?: ReturnType<typeof vi.fn>;
}
interface IssueStubs {
  createComment?: ReturnType<typeof vi.fn>;
}

function makeClient({ prs, issues }: { prs?: PrStubs; issues?: IssueStubs }): GitHubClient {
  return {
    rest: {
      pulls: {
        create: prs?.create ?? vi.fn(),
        get: prs?.get ?? vi.fn(),
        list: prs?.list ?? vi.fn(),
      },
      issues: {
        createComment: issues?.createComment ?? vi.fn(),
      },
    },
  } as unknown as GitHubClient;
}

const samplePr = {
  number: 42,
  title: 'Add pagination',
  body: 'description',
  state: 'open',
  merged: false,
  head: { ref: 'feature/pagination' },
  base: { ref: 'main' },
  html_url: 'https://github.com/example-org/r/pull/42',
  diff_url: 'https://github.com/example-org/r/pull/42.diff',
  created_at: '2026-05-18T00:00:00Z',
  updated_at: '2026-05-18T00:01:00Z',
  user: { login: 'example-org', html_url: 'https://github.com/example-org' },
};

describe('createPullRequest', () => {
  it('forwards required fields and maps the response to the SPEX shape', async () => {
    const create = vi.fn().mockResolvedValue({ data: samplePr });
    const client = makeClient({ prs: { create } });

    const result = await createPullRequest({
      client,
      owner: 'example-org',
      repo: 'r',
      title: 'Add pagination',
      body: 'description',
      head: 'feature/pagination',
      base: 'main',
    });

    expect(create).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'r',
      title: 'Add pagination',
      body: 'description',
      head: 'feature/pagination',
      base: 'main',
    });
    expect(result).toEqual({
      number: 42,
      title: 'Add pagination',
      body: 'description',
      state: 'open',
      merged: false,
      head: 'feature/pagination',
      base: 'main',
      htmlUrl: 'https://github.com/example-org/r/pull/42',
      diffUrl: 'https://github.com/example-org/r/pull/42.diff',
      createdAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T00:01:00Z',
      user: { login: 'example-org', htmlUrl: 'https://github.com/example-org' },
    });
  });

  it('omits body when not provided and passes draft when set', async () => {
    const create = vi.fn().mockResolvedValue({ data: samplePr });
    const client = makeClient({ prs: { create } });
    await createPullRequest({
      client,
      owner: 'example-org',
      repo: 'r',
      title: 't',
      head: 'h',
      base: 'main',
      draft: true,
    });
    expect(create).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'r',
      title: 't',
      head: 'h',
      base: 'main',
      draft: true,
    });
  });

  it('maps merged=true and closed state correctly', async () => {
    const create = vi.fn().mockResolvedValue({
      data: { ...samplePr, state: 'closed', merged: true },
    });
    const client = makeClient({ prs: { create } });
    const result = await createPullRequest({
      client,
      owner: 'example-org',
      repo: 'r',
      title: 't',
      head: 'h',
      base: 'main',
    });
    expect(result.state).toBe('closed');
    expect(result.merged).toBe(true);
  });
});

describe('readPullRequest', () => {
  it('calls pulls.get with pull_number and maps the response', async () => {
    const get = vi.fn().mockResolvedValue({ data: samplePr });
    const client = makeClient({ prs: { get } });
    const result = await readPullRequest({
      client,
      owner: 'example-org',
      repo: 'r',
      prNumber: 42,
    });
    expect(get).toHaveBeenCalledWith({ owner: 'example-org', repo: 'r', pull_number: 42 });
    expect(result.number).toBe(42);
    expect(result.head).toBe('feature/pagination');
    expect(result.base).toBe('main');
  });
});

describe('commentOnPullRequest', () => {
  it('uses the issues.createComment endpoint with issue_number=prNumber', async () => {
    const createComment = vi.fn().mockResolvedValue({
      data: {
        id: 1,
        body: 'LGTM',
        user: { login: 'example-org', html_url: 'https://github.com/example-org' },
        created_at: '2026-05-18T00:00:00Z',
        html_url: 'https://github.com/example-org/r/issues/42#issuecomment-1',
      },
    });
    const client = makeClient({ issues: { createComment } });

    const result = await commentOnPullRequest({
      client,
      owner: 'example-org',
      repo: 'r',
      prNumber: 42,
      body: 'LGTM',
    });

    expect(createComment).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'r',
      issue_number: 42,
      body: 'LGTM',
    });
    expect(result).toMatchObject({ id: 1, body: 'LGTM' });
  });
});

describe('readPullRequestDiff', () => {
  it('requests the diff media type and returns the raw diff string', async () => {
    const get = vi.fn().mockResolvedValue({
      data: '--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n',
    });
    const client = makeClient({ prs: { get } });

    const diff = await readPullRequestDiff({
      client,
      owner: 'example-org',
      repo: 'r',
      prNumber: 42,
    });

    expect(get).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'r',
      pull_number: 42,
      mediaType: { format: 'diff' },
    });
    expect(diff).toContain('+new');
  });
});

describe('listPullRequests', () => {
  it('defaults to state=open and maps each entry', async () => {
    const list = vi.fn().mockResolvedValue({ data: [samplePr, { ...samplePr, number: 43 }] });
    const client = makeClient({ prs: { list } });

    const result = await listPullRequests({ client, owner: 'example-org', repo: 'r' });

    expect(list).toHaveBeenCalledWith({ owner: 'example-org', repo: 'r', state: 'open' });
    expect(result.map((p) => p.number)).toEqual([42, 43]);
  });

  it('passes state and perPage when supplied', async () => {
    const list = vi.fn().mockResolvedValue({ data: [] });
    const client = makeClient({ prs: { list } });
    await listPullRequests({
      client,
      owner: 'example-org',
      repo: 'r',
      state: 'all',
      perPage: 100,
    });
    expect(list).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'r',
      state: 'all',
      per_page: 100,
    });
  });
});
