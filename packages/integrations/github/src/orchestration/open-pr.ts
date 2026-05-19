import type { GitHubClient } from '../client.js';
import { pushBranchToGitHub } from '../operations/branches.js';
import { createPullRequest } from '../operations/prs.js';
import type { GitHubPullRequest } from '../types.js';

export interface OpenPullRequestFlowOptions {
  client: GitHubClient;
  projectDir: string;
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  token: string;
  host?: string;
  title: string;
  body: string;
  labels?: readonly string[];
  draft?: boolean;
}

export interface OpenPullRequestFlowResult {
  pullRequest: GitHubPullRequest;
  appliedLabels: readonly string[];
}

/**
 * Push a branch to GitHub via HTTPS+token, open a PR against `baseBranch`,
 * and apply labels.
 *
 * Errors from `pushBranchToGitHub` and `createPullRequest` propagate to the
 * caller — the CLI is responsible for wrapping them with user-facing messages.
 * Label-application errors are swallowed so a label mistake never causes the
 * caller to think the PR itself failed; the returned `appliedLabels` reflects
 * which labels actually got attached.
 */
export async function openPullRequestFlow(
  options: OpenPullRequestFlowOptions,
): Promise<OpenPullRequestFlowResult> {
  await pushBranchToGitHub({
    projectDir: options.projectDir,
    owner: options.owner,
    repo: options.repo,
    branch: options.branch,
    token: options.token,
    ...(options.host !== undefined ? { host: options.host } : {}),
  });

  const pullRequest = await createPullRequest({
    client: options.client,
    owner: options.owner,
    repo: options.repo,
    title: options.title,
    body: options.body,
    head: options.branch,
    base: options.baseBranch,
    ...(options.draft !== undefined ? { draft: options.draft } : {}),
  });

  const labels = dedupe(options.labels ?? []);
  let appliedLabels: readonly string[] = [];
  if (labels.length > 0) {
    try {
      await options.client.rest.issues.addLabels({
        owner: options.owner,
        repo: options.repo,
        issue_number: pullRequest.number,
        labels: [...labels],
      });
      appliedLabels = labels;
    } catch {
      // Labels are non-essential — a label error (missing label, perms, etc.)
      // must not poison the success signal for the PR itself.
      appliedLabels = [];
    }
  }

  return { pullRequest, appliedLabels };
}

function dedupe(labels: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of labels) {
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}
