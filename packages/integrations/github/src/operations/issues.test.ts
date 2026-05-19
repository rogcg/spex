import { describe, expect, it, vi } from 'vitest';
import type { GitHubClient } from '../client.js';
import { commentOnIssue, listIssues, readIssue } from './issues.js';

interface IssueStubs {
  get?: ReturnType<typeof vi.fn>;
  listForRepo?: ReturnType<typeof vi.fn>;
  createComment?: ReturnType<typeof vi.fn>;
}

function makeClient(stubs: IssueStubs = {}): GitHubClient {
  return {
    rest: {
      issues: {
        get: stubs.get ?? vi.fn(),
        listForRepo: stubs.listForRepo ?? vi.fn(),
        createComment: stubs.createComment ?? vi.fn(),
      },
    },
  } as unknown as GitHubClient;
}

const sampleIssue = {
  number: 7,
  title: 'Pagination resets',
  body: 'Filter change drops state',
  state: 'open',
  html_url: 'https://github.com/example-org/r/issues/7',
  created_at: '2026-05-18T00:00:00Z',
  updated_at: '2026-05-18T00:01:00Z',
  user: { login: 'example-org', html_url: 'https://github.com/example-org' },
  labels: [
    'bug',
    { name: 'pagination' },
    { name: null }, // ignored
  ],
};

describe('readIssue', () => {
  it('calls issues.get with issue_number and maps the response', async () => {
    const get = vi.fn().mockResolvedValue({ data: sampleIssue });
    const client = makeClient({ get });

    const result = await readIssue({ client, owner: 'example-org', repo: 'r', number: 7 });

    expect(get).toHaveBeenCalledWith({ owner: 'example-org', repo: 'r', issue_number: 7 });
    expect(result).toMatchObject({
      number: 7,
      title: 'Pagination resets',
      state: 'open',
      labels: ['bug', 'pagination'],
      isPullRequest: false,
    });
    expect(result.user).toEqual({
      login: 'example-org',
      htmlUrl: 'https://github.com/example-org',
    });
  });

  it('flags isPullRequest=true when GitHub returns the pull_request field', async () => {
    const get = vi.fn().mockResolvedValue({
      data: { ...sampleIssue, pull_request: { url: '/pulls/7' } },
    });
    const client = makeClient({ get });
    const result = await readIssue({ client, owner: 'example-org', repo: 'r', number: 7 });
    expect(result.isPullRequest).toBe(true);
  });
});

describe('listIssues', () => {
  it('defaults to state=open and maps each entry', async () => {
    const listForRepo = vi
      .fn()
      .mockResolvedValue({ data: [sampleIssue, { ...sampleIssue, number: 8 }] });
    const client = makeClient({ listForRepo });

    const result = await listIssues({ client, owner: 'example-org', repo: 'r' });

    expect(listForRepo).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'r',
      state: 'open',
    });
    expect(result.map((i) => i.number)).toEqual([7, 8]);
  });

  it('joins labels with commas when provided', async () => {
    const listForRepo = vi.fn().mockResolvedValue({ data: [] });
    const client = makeClient({ listForRepo });
    await listIssues({
      client,
      owner: 'example-org',
      repo: 'r',
      labels: ['bug', 'priority:high'],
    });
    expect(listForRepo).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'r',
      state: 'open',
      labels: 'bug,priority:high',
    });
  });

  it('passes perPage as per_page', async () => {
    const listForRepo = vi.fn().mockResolvedValue({ data: [] });
    const client = makeClient({ listForRepo });
    await listIssues({ client, owner: 'example-org', repo: 'r', state: 'all', perPage: 50 });
    expect(listForRepo).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'r',
      state: 'all',
      per_page: 50,
    });
  });
});

describe('commentOnIssue', () => {
  it('calls issues.createComment with issueNumber as issue_number', async () => {
    const createComment = vi.fn().mockResolvedValue({
      data: {
        id: 99,
        body: 'thanks',
        user: { login: 'example-org', html_url: 'https://github.com/example-org' },
        created_at: '2026-05-18T00:00:00Z',
        html_url: 'https://github.com/example-org/r/issues/7#issuecomment-99',
      },
    });
    const client = makeClient({ createComment });

    const result = await commentOnIssue({
      client,
      owner: 'example-org',
      repo: 'r',
      issueNumber: 7,
      body: 'thanks',
    });

    expect(createComment).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'r',
      issue_number: 7,
      body: 'thanks',
    });
    expect(result.id).toBe(99);
    expect(result.body).toBe('thanks');
  });
});
