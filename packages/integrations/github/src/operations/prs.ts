import type { GitHubClient } from '../client.js';
import type {
  GitHubComment,
  GitHubPullRequest,
  GitHubPullRequestState,
  GitHubUser,
} from '../types.js';

export interface CreatePullRequestOptions {
  client: GitHubClient;
  owner: string;
  repo: string;
  /** Title of the PR. */
  title: string;
  /** Body / description in markdown. */
  body?: string;
  /** Source branch (the one being merged FROM). */
  head: string;
  /** Target branch (the one being merged INTO). */
  base: string;
  /** Create as a draft PR. Defaults to false. */
  draft?: boolean;
}

export async function createPullRequest(
  options: CreatePullRequestOptions,
): Promise<GitHubPullRequest> {
  const response = await options.client.rest.pulls.create({
    owner: options.owner,
    repo: options.repo,
    title: options.title,
    head: options.head,
    base: options.base,
    ...(options.body !== undefined ? { body: options.body } : {}),
    ...(options.draft !== undefined ? { draft: options.draft } : {}),
  });
  return mapPullRequest(response.data);
}

export interface ReadPullRequestOptions {
  client: GitHubClient;
  owner: string;
  repo: string;
  prNumber: number;
}

/**
 * Fetch the metadata for a single PR (title, body, head/base refs, etc.) —
 * the JSON form, NOT the diff. Use `readPullRequestDiff` for the unified diff.
 */
export async function readPullRequest(options: ReadPullRequestOptions): Promise<GitHubPullRequest> {
  const response = await options.client.rest.pulls.get({
    owner: options.owner,
    repo: options.repo,
    pull_number: options.prNumber,
  });
  return mapPullRequest(response.data);
}

export interface CommentOnPullRequestOptions {
  client: GitHubClient;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
}

/**
 * Add a top-level issue-style comment on a PR. (For inline review comments
 * with line anchors, use the PR review endpoints.)
 */
export async function commentOnPullRequest(
  options: CommentOnPullRequestOptions,
): Promise<GitHubComment> {
  const response = await options.client.rest.issues.createComment({
    owner: options.owner,
    repo: options.repo,
    issue_number: options.prNumber,
    body: options.body,
  });
  return mapComment(response.data);
}

export interface ReadPullRequestDiffOptions {
  client: GitHubClient;
  owner: string;
  repo: string;
  prNumber: number;
}

/**
 * Fetch the unified diff of a PR. Uses GitHub's `application/vnd.github.v3.diff`
 * media type, which makes Octokit return a raw string in `response.data`.
 */
export async function readPullRequestDiff(options: ReadPullRequestDiffOptions): Promise<string> {
  const response = await options.client.rest.pulls.get({
    owner: options.owner,
    repo: options.repo,
    pull_number: options.prNumber,
    mediaType: { format: 'diff' },
  });
  // With mediaType.format='diff' Octokit returns the raw diff string but the
  // generated types still say `data: PullRequest`. Cast through unknown.
  return response.data as unknown as string;
}

export interface ListPullRequestsOptions {
  client: GitHubClient;
  owner: string;
  repo: string;
  state?: GitHubPullRequestState | 'all';
  /** Defaults to 30 (Octokit's default page size). */
  perPage?: number;
}

export async function listPullRequests(
  options: ListPullRequestsOptions,
): Promise<GitHubPullRequest[]> {
  const response = await options.client.rest.pulls.list({
    owner: options.owner,
    repo: options.repo,
    state: options.state ?? 'open',
    ...(options.perPage !== undefined ? { per_page: options.perPage } : {}),
  });
  return response.data.map(mapPullRequest);
}

interface OctokitPullRequest {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  merged?: boolean;
  head: { ref: string };
  base: { ref: string };
  html_url: string;
  diff_url: string;
  created_at: string;
  updated_at: string;
  user: OctokitUser | null;
}

interface OctokitUser {
  login: string;
  html_url: string;
}

interface OctokitComment {
  id: number;
  body?: string | null;
  user: OctokitUser | null;
  created_at: string;
  html_url: string;
}

function mapPullRequest(pr: OctokitPullRequest): GitHubPullRequest {
  const state: GitHubPullRequestState = pr.state === 'closed' ? 'closed' : 'open';
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? null,
    state,
    merged: pr.merged === true,
    head: pr.head.ref,
    base: pr.base.ref,
    htmlUrl: pr.html_url,
    diffUrl: pr.diff_url,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    user: pr.user ? mapUser(pr.user) : null,
  };
}

function mapComment(comment: OctokitComment): GitHubComment {
  return {
    id: comment.id,
    body: comment.body ?? '',
    user: comment.user ? mapUser(comment.user) : null,
    createdAt: comment.created_at,
    htmlUrl: comment.html_url,
  };
}

function mapUser(user: OctokitUser): GitHubUser {
  return { login: user.login, htmlUrl: user.html_url };
}

/** Exported only for use by `issues.ts` to share the comment / user mappers. */
export const __internalMappers = {
  mapComment,
  mapUser,
};
