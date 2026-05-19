import { SpexError } from '@spex/core';
import { execa } from 'execa';
import type { GitHubClient } from '../client.js';
import type { GitHubBranch, RepoCoords } from '../types.js';

export class BranchPushError extends SpexError {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly exitCode: number | null;

  constructor(opts: {
    owner: string;
    repo: string;
    branch: string;
    exitCode: number | null;
    stderr: string;
  }) {
    super(
      `Failed to push branch ${opts.branch} to ${opts.owner}/${opts.repo} (exit ${
        opts.exitCode ?? 'unknown'
      }): ${redactToken(opts.stderr).trim() || 'no stderr output'}`,
    );
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.branch = opts.branch;
    this.exitCode = opts.exitCode;
  }
}

export interface CreateBranchOnGitHubOptions {
  client: GitHubClient;
  owner: string;
  repo: string;
  branch: string;
  /** Commit SHA to point the new ref at. */
  fromSha: string;
}

/**
 * Create a branch on GitHub by adding a ref (`refs/heads/<branch>`) pointing
 * to `fromSha`. This does NOT push local commits — use {@link pushBranchToGitHub}
 * for that.
 */
export async function createBranchOnGitHub(
  options: CreateBranchOnGitHubOptions,
): Promise<GitHubBranch> {
  const response = await options.client.rest.git.createRef({
    owner: options.owner,
    repo: options.repo,
    ref: `refs/heads/${options.branch}`,
    sha: options.fromSha,
  });
  return {
    name: options.branch,
    sha: response.data.object.sha,
    protected: false,
  };
}

export interface DeleteBranchOnGitHubOptions {
  client: GitHubClient;
  owner: string;
  repo: string;
  branch: string;
}

export async function deleteBranchOnGitHub(options: DeleteBranchOnGitHubOptions): Promise<void> {
  await options.client.rest.git.deleteRef({
    owner: options.owner,
    repo: options.repo,
    ref: `heads/${options.branch}`,
  });
}

export interface PushBranchToGitHubOptions extends RepoCoords {
  /** Local working tree of the project. The push runs with `cwd = projectDir`. */
  projectDir: string;
  /** Branch name to push (must already exist locally). */
  branch: string;
  /**
   * GitHub personal access token. SPEX constructs an explicit
   * `https://x-access-token:<token>@github.com/<owner>/<repo>.git` URL so the
   * push bypasses any SSH remote alias on the user's machine. The token
   * appears in argv only — never in `~/.gitconfig`, never in stderr (we
   * redact it before throwing).
   */
  token: string;
  /** Override the host (for GitHub Enterprise). Defaults to `github.com`. */
  host?: string;
}

/**
 * Push a local branch to GitHub via HTTPS with an explicit token. **Does NOT**
 * use `git push origin` — that would honour any existing `origin` remote URL
 * (potentially a work-account SSH alias). The URL constructed here always
 * resolves to `<host>/<owner>/<repo>.git`.
 */
export async function pushBranchToGitHub(options: PushBranchToGitHubOptions): Promise<void> {
  const host = options.host ?? 'github.com';
  if (host.includes('/')) {
    throw new SpexError(
      `pushBranchToGitHub: host must be a bare host (e.g. "github.com"), got "${host}"`,
    );
  }
  if (options.owner.includes('/') || options.repo.includes('/')) {
    throw new SpexError(
      `pushBranchToGitHub: owner/repo must not contain '/' (got owner="${options.owner}", repo="${options.repo}")`,
    );
  }
  const url = `https://x-access-token:${options.token}@${host}/${options.owner}/${options.repo}.git`;
  try {
    await execa('git', ['push', url, options.branch], {
      cwd: options.projectDir,
      stdio: 'pipe',
      reject: true,
    });
  } catch (cause) {
    const exitCode = extractExitCode(cause);
    const stderr = extractString(cause, 'stderr');
    throw new BranchPushError({
      owner: options.owner,
      repo: options.repo,
      branch: options.branch,
      exitCode,
      stderr,
    });
  }
}

function extractExitCode(cause: unknown): number | null {
  if (cause !== null && typeof cause === 'object' && 'exitCode' in cause) {
    const code = (cause as { exitCode: unknown }).exitCode;
    if (typeof code === 'number') return code;
  }
  return null;
}

function extractString(cause: unknown, key: 'stderr' | 'stdout'): string {
  if (cause !== null && typeof cause === 'object' && key in cause) {
    const value = (cause as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

/**
 * Replace any `x-access-token:<token>@` segment in a string with
 * `x-access-token:***@` so logs / error messages don't leak tokens.
 */
function redactToken(text: string): string {
  return text.replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');
}
