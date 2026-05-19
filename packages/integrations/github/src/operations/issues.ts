import type { GitHubClient } from '../client.js';
import type { GitHubComment, GitHubIssue, GitHubIssueState, GitHubUser } from '../types.js';
import { __internalMappers } from './prs.js';

const { mapComment, mapUser } = __internalMappers;

export interface ReadIssueOptions {
  client: GitHubClient;
  owner: string;
  repo: string;
  number: number;
}

export async function readIssue(options: ReadIssueOptions): Promise<GitHubIssue> {
  const response = await options.client.rest.issues.get({
    owner: options.owner,
    repo: options.repo,
    issue_number: options.number,
  });
  return mapIssue(response.data);
}

export interface ListIssuesOptions {
  client: GitHubClient;
  owner: string;
  repo: string;
  state?: GitHubIssueState | 'all';
  /** Filter to issues with ALL of these label names. */
  labels?: readonly string[];
  perPage?: number;
}

export async function listIssues(options: ListIssuesOptions): Promise<GitHubIssue[]> {
  const response = await options.client.rest.issues.listForRepo({
    owner: options.owner,
    repo: options.repo,
    state: options.state ?? 'open',
    ...(options.labels && options.labels.length > 0 ? { labels: options.labels.join(',') } : {}),
    ...(options.perPage !== undefined ? { per_page: options.perPage } : {}),
  });
  return response.data.map(mapIssue);
}

export interface CommentOnIssueOptions {
  client: GitHubClient;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}

export async function commentOnIssue(options: CommentOnIssueOptions): Promise<GitHubComment> {
  const response = await options.client.rest.issues.createComment({
    owner: options.owner,
    repo: options.repo,
    issue_number: options.issueNumber,
    body: options.body,
  });
  return mapComment(response.data);
}

interface OctokitIssue {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  user: { login: string; html_url: string } | null;
  labels: Array<string | { name?: string | null }>;
  pull_request?: unknown;
}

function mapIssue(issue: OctokitIssue): GitHubIssue {
  const state: GitHubIssueState = issue.state === 'closed' ? 'closed' : 'open';
  const labels = issue.labels
    .map((label) => (typeof label === 'string' ? label : (label.name ?? null)))
    .filter((label): label is string => typeof label === 'string' && label.length > 0);
  const user: GitHubUser | null = issue.user
    ? mapUser({ login: issue.user.login, html_url: issue.user.html_url })
    : null;
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? null,
    state,
    htmlUrl: issue.html_url,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    user,
    labels,
    isPullRequest: issue.pull_request !== undefined,
  };
}
