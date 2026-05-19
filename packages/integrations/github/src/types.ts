/**
 * Repository coordinates. Always passed as `{ owner, repo }` so callers can't
 * accidentally swap the order of two strings.
 */
export interface RepoCoords {
  owner: string;
  repo: string;
}

export interface GitHubBranch {
  name: string;
  /** Tip commit SHA. */
  sha: string;
  /** Whether branch protection rules apply. */
  protected: boolean;
}

export interface GitHubUser {
  login: string;
  htmlUrl: string;
}

export type GitHubPullRequestState = 'open' | 'closed';

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: GitHubPullRequestState;
  /** True only after a merge — `state` may be `'closed'` either way. */
  merged: boolean;
  /** Source branch (the one being merged FROM). */
  head: string;
  /** Target branch (the one being merged INTO). */
  base: string;
  htmlUrl: string;
  diffUrl: string;
  createdAt: string;
  updatedAt: string;
  user: GitHubUser | null;
}

export type GitHubIssueState = 'open' | 'closed';

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: GitHubIssueState;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  user: GitHubUser | null;
  labels: string[];
  /** True when the underlying GitHub object is a PR, not a plain issue. */
  isPullRequest: boolean;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: GitHubUser | null;
  createdAt: string;
  htmlUrl: string;
}
