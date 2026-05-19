import { beforeEach, describe, expect, it, vi } from 'vitest';

const execaMock = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: execaMock }));

import type { GitHubClient } from '../client.js';
import { openPullRequestFlow } from './open-pr.js';

interface ClientStubs {
  createPr?: ReturnType<typeof vi.fn>;
  addLabels?: ReturnType<typeof vi.fn>;
}

function makeClient(stubs: ClientStubs = {}): GitHubClient {
  return {
    rest: {
      pulls: { create: stubs.createPr ?? vi.fn() },
      issues: { addLabels: stubs.addLabels ?? vi.fn() },
    },
  } as unknown as GitHubClient;
}

const samplePr = {
  number: 42,
  title: 'feat(x): do the thing',
  body: 'body',
  state: 'open',
  merged: false,
  head: { ref: 'feature/x' },
  base: { ref: 'main' },
  html_url: 'https://github.com/example-org/r/pull/42',
  diff_url: 'https://github.com/example-org/r/pull/42.diff',
  created_at: '2026-05-18T00:00:00Z',
  updated_at: '2026-05-18T00:01:00Z',
  user: { login: 'example-org', html_url: 'https://github.com/example-org' },
};

beforeEach(() => {
  execaMock.mockReset();
  execaMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});

describe('openPullRequestFlow', () => {
  it('pushes the branch, creates the PR, and applies labels in order', async () => {
    const createPr = vi.fn().mockResolvedValue({ data: samplePr });
    const addLabels = vi.fn().mockResolvedValue({ data: [] });
    const client = makeClient({ createPr, addLabels });

    const result = await openPullRequestFlow({
      client,
      projectDir: '/tmp/sandbox',
      owner: 'example-org',
      repo: 'r',
      branch: 'feature/x',
      baseBranch: 'main',
      token: 'github_pat_test',
      title: 'feat(x): do the thing',
      body: 'body',
      labels: ['spex-generated', 'feature'],
    });

    // push happened
    expect(execaMock).toHaveBeenCalledTimes(1);
    const pushCall = execaMock.mock.calls[0];
    if (!pushCall) throw new Error('execa was not called');
    const [bin, args] = pushCall;
    expect(bin).toBe('git');
    expect(args[0]).toBe('push');
    expect(args[1]).toBe('https://x-access-token:github_pat_test@github.com/example-org/r.git');
    expect(args[2]).toBe('feature/x');

    // PR created with the right params
    expect(createPr).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'r',
      title: 'feat(x): do the thing',
      body: 'body',
      head: 'feature/x',
      base: 'main',
    });

    // Labels applied
    expect(addLabels).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'r',
      issue_number: 42,
      labels: ['spex-generated', 'feature'],
    });

    expect(result.pullRequest.number).toBe(42);
    expect(result.appliedLabels).toEqual(['spex-generated', 'feature']);
  });

  it('skips the addLabels call when labels is empty', async () => {
    const createPr = vi.fn().mockResolvedValue({ data: samplePr });
    const addLabels = vi.fn();
    const client = makeClient({ createPr, addLabels });

    const result = await openPullRequestFlow({
      client,
      projectDir: '/tmp/sandbox',
      owner: 'example-org',
      repo: 'r',
      branch: 'feature/x',
      baseBranch: 'main',
      token: 'github_pat_test',
      title: 't',
      body: 'b',
    });

    expect(addLabels).not.toHaveBeenCalled();
    expect(result.appliedLabels).toEqual([]);
  });

  it('dedupes labels before sending them', async () => {
    const createPr = vi.fn().mockResolvedValue({ data: samplePr });
    const addLabels = vi.fn().mockResolvedValue({ data: [] });
    const client = makeClient({ createPr, addLabels });

    await openPullRequestFlow({
      client,
      projectDir: '/tmp/sandbox',
      owner: 'example-org',
      repo: 'r',
      branch: 'feature/x',
      baseBranch: 'main',
      token: 'github_pat_test',
      title: 't',
      body: 'b',
      labels: ['spex-generated', 'feature', 'spex-generated'],
    });

    expect(addLabels).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'r',
      issue_number: 42,
      labels: ['spex-generated', 'feature'],
    });
  });

  it('returns an empty appliedLabels list when label application throws', async () => {
    const createPr = vi.fn().mockResolvedValue({ data: samplePr });
    const addLabels = vi.fn().mockRejectedValue(new Error('label not found'));
    const client = makeClient({ createPr, addLabels });

    const result = await openPullRequestFlow({
      client,
      projectDir: '/tmp/sandbox',
      owner: 'example-org',
      repo: 'r',
      branch: 'feature/x',
      baseBranch: 'main',
      token: 'github_pat_test',
      title: 't',
      body: 'b',
      labels: ['nope'],
    });

    // PR still returned; appliedLabels is empty since the call failed
    expect(result.pullRequest.number).toBe(42);
    expect(result.appliedLabels).toEqual([]);
  });

  it('propagates push errors and does NOT call the PR create', async () => {
    execaMock.mockReset();
    execaMock.mockRejectedValue(
      Object.assign(new Error('push rejected'), { stderr: 'denied', exitCode: 128 }),
    );
    const createPr = vi.fn();
    const client = makeClient({ createPr });

    await expect(
      openPullRequestFlow({
        client,
        projectDir: '/tmp/sandbox',
        owner: 'example-org',
        repo: 'r',
        branch: 'feature/x',
        baseBranch: 'main',
        token: 'github_pat_test',
        title: 't',
        body: 'b',
      }),
    ).rejects.toThrow(/push/i);

    expect(createPr).not.toHaveBeenCalled();
  });

  it('forwards the host option to the push step', async () => {
    const createPr = vi.fn().mockResolvedValue({ data: samplePr });
    const client = makeClient({ createPr });
    await openPullRequestFlow({
      client,
      projectDir: '/tmp/sandbox',
      owner: 'example-org',
      repo: 'r',
      branch: 'feature/x',
      baseBranch: 'main',
      token: 'tok',
      host: 'ghe.example.com',
      title: 't',
      body: 'b',
    });
    const call = execaMock.mock.calls[0];
    if (!call) throw new Error('execa was not called');
    const [, args] = call;
    expect(args[1]).toBe('https://x-access-token:tok@ghe.example.com/example-org/r.git');
  });
});
