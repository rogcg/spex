import { beforeEach, describe, expect, it, vi } from 'vitest';

const execaMock = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: execaMock }));

import type { GitHubClient } from '../client.js';
import {
  BranchPushError,
  createBranchOnGitHub,
  deleteBranchOnGitHub,
  pushBranchToGitHub,
} from './branches.js';

function makeClient(overrides: {
  createRef?: ReturnType<typeof vi.fn>;
  deleteRef?: ReturnType<typeof vi.fn>;
}): GitHubClient {
  return {
    rest: {
      git: {
        createRef: overrides.createRef ?? vi.fn(),
        deleteRef: overrides.deleteRef ?? vi.fn(),
      },
    },
  } as unknown as GitHubClient;
}

describe('createBranchOnGitHub', () => {
  it('calls git/refs createRef with refs/heads/ prefix and returns the branch shape', async () => {
    const createRef = vi.fn().mockResolvedValue({
      data: { object: { sha: 'abc1234567890abcdef1234567890abcdef12345' } },
    });
    const client = makeClient({ createRef });

    const result = await createBranchOnGitHub({
      client,
      owner: 'example-org',
      repo: 'spex-sandbox-e2e',
      branch: 'feature/add-pagination',
      fromSha: 'abc1234567890abcdef1234567890abcdef12345',
    });

    expect(createRef).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'spex-sandbox-e2e',
      ref: 'refs/heads/feature/add-pagination',
      sha: 'abc1234567890abcdef1234567890abcdef12345',
    });
    expect(result).toEqual({
      name: 'feature/add-pagination',
      sha: 'abc1234567890abcdef1234567890abcdef12345',
      protected: false,
    });
  });
});

describe('deleteBranchOnGitHub', () => {
  it('calls git/refs deleteRef with heads/ prefix (no leading refs/)', async () => {
    const deleteRef = vi.fn().mockResolvedValue({});
    const client = makeClient({ deleteRef });

    await deleteBranchOnGitHub({
      client,
      owner: 'example-org',
      repo: 'spex-sandbox-e2e',
      branch: 'feature/old',
    });

    expect(deleteRef).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'spex-sandbox-e2e',
      ref: 'heads/feature/old',
    });
  });
});

describe('pushBranchToGitHub', () => {
  beforeEach(() => {
    execaMock.mockReset();
  });

  it('runs `git push` with an HTTPS+token URL (no SSH, no origin remote)', async () => {
    execaMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

    await pushBranchToGitHub({
      projectDir: '/tmp/sandbox',
      owner: 'example-org',
      repo: 'spex-sandbox-e2e',
      branch: 'feature/add-pagination',
      token: 'github_pat_TESTTOKEN',
    });

    expect(execaMock).toHaveBeenCalledTimes(1);
    const call = execaMock.mock.calls[0];
    if (!call) throw new Error('execa not called');
    const [bin, args, opts] = call;
    expect(bin).toBe('git');
    expect(args).toEqual([
      'push',
      'https://x-access-token:github_pat_TESTTOKEN@github.com/example-org/spex-sandbox-e2e.git',
      'feature/add-pagination',
    ]);
    expect(opts).toMatchObject({
      cwd: '/tmp/sandbox',
      stdio: 'pipe',
    });
  });

  it('honours a custom host (for GitHub Enterprise)', async () => {
    execaMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

    await pushBranchToGitHub({
      projectDir: '/tmp/sandbox',
      owner: 'example-org',
      repo: 'spex-sandbox-e2e',
      branch: 'feature/x',
      token: 'tok',
      host: 'ghe.example.com',
    });

    const call = execaMock.mock.calls[0];
    if (!call) throw new Error('execa not called');
    const [, args] = call;
    expect(args[1]).toBe(
      'https://x-access-token:tok@ghe.example.com/example-org/spex-sandbox-e2e.git',
    );
  });

  it('rejects a host that contains a slash', async () => {
    await expect(
      pushBranchToGitHub({
        projectDir: '/tmp',
        owner: 'example-org',
        repo: 'r',
        branch: 'b',
        token: 'tok',
        host: 'evil.com/path',
      }),
    ).rejects.toThrow(/host must be a bare host/);
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('rejects an owner or repo containing a slash', async () => {
    await expect(
      pushBranchToGitHub({
        projectDir: '/tmp',
        owner: 'example-org/extra',
        repo: 'r',
        branch: 'b',
        token: 'tok',
      }),
    ).rejects.toThrow(/owner\/repo must not contain '\/'/);
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('throws BranchPushError with redacted token when push fails', async () => {
    execaMock.mockRejectedValue(
      Object.assign(new Error('fatal'), {
        exitCode: 128,
        stderr:
          'remote: invalid credentials for https://x-access-token:github_pat_SECRET@github.com/example-org/r.git\n',
      }),
    );

    await expect(
      pushBranchToGitHub({
        projectDir: '/tmp',
        owner: 'example-org',
        repo: 'r',
        branch: 'b',
        token: 'github_pat_SECRET',
      }),
    ).rejects.toMatchObject({
      name: 'BranchPushError',
      exitCode: 128,
      branch: 'b',
    });

    // The thrown error message should NOT contain the literal token.
    try {
      await pushBranchToGitHub({
        projectDir: '/tmp',
        owner: 'example-org',
        repo: 'r',
        branch: 'b',
        token: 'github_pat_SECRET',
      });
      throw new Error('expected BranchPushError');
    } catch (err) {
      expect(err).toBeInstanceOf(BranchPushError);
      expect((err as Error).message).not.toContain('github_pat_SECRET');
      expect((err as Error).message).toContain('x-access-token:***');
    }
  });
});
