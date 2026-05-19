import {
  type LLMProvider,
  buildCodebaseContext,
  formatReviewAsMarkdown,
  generateReview,
  loadFeatureSpec,
  loadTechSpec,
} from '@spex/core';
import type { ReviewMode, ReviewResult } from '@spex/schemas';
import type { GitHubClient } from '../client.js';
import { commentOnPullRequest, readPullRequest, readPullRequestDiff } from '../operations/prs.js';
import type { GitHubComment } from '../types.js';

export interface RunReviewFlowOptions {
  client: GitHubClient;
  llm: LLMProvider;
  projectDir: string;
  owner: string;
  repo: string;
  prNumber: number;
  reviewMode?: ReviewMode;
  /**
   * Function that decides whether to post the rendered review comment to the PR.
   * Called with the generated `markdown` so the caller can preview before
   * deciding. Return `true` to post, `false` to skip. Throw to abort.
   * Defaults to "do not post" (caller is expected to gate posting explicitly).
   */
  shouldPost?: (markdown: string) => Promise<boolean> | boolean;
}

export interface RunReviewFlowResult {
  result: ReviewResult;
  markdown: string;
  pullRequest: { number: number; head: string; base: string };
  featureSpecPath: string | null;
  /** Non-null when the review was actually posted. */
  comment: GitHubComment | null;
}

/**
 * End-to-end review flow used by both the CLI `spex review` command and the
 * `spex_review` MCP tool. Fetches PR + diff + linked specs, generates a
 * structured review, renders Markdown, and optionally posts it as a comment.
 */
export async function runReviewFlow(options: RunReviewFlowOptions): Promise<RunReviewFlowResult> {
  const pr = await readPullRequest({
    client: options.client,
    owner: options.owner,
    repo: options.repo,
    prNumber: options.prNumber,
  });

  const diff = await readPullRequestDiff({
    client: options.client,
    owner: options.owner,
    repo: options.repo,
    prNumber: options.prNumber,
  });

  const featureSpecPath = featureSpecPathFromBranch(pr.head);
  const featureSpec = featureSpecPath
    ? await loadFeatureSpec({ projectDir: options.projectDir, relativePath: featureSpecPath })
    : null;

  const techSpec = await loadTechSpec(options.projectDir);
  const codebaseContext = await buildCodebaseContext({ projectDir: options.projectDir }).catch(
    () => null,
  );

  const result = await generateReview({
    llm: options.llm,
    mode: options.reviewMode ?? 'single',
    context: {
      pullRequest: {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        head: pr.head,
        base: pr.base,
      },
      diff,
      featureSpec,
      techSpec,
      codebaseContext,
    },
  });

  const markdown = formatReviewAsMarkdown(result);

  const shouldPostFn = options.shouldPost ?? (() => false);
  const shouldPost = await shouldPostFn(markdown);

  let comment: GitHubComment | null = null;
  if (shouldPost) {
    comment = await commentOnPullRequest({
      client: options.client,
      owner: options.owner,
      repo: options.repo,
      prNumber: options.prNumber,
      body: markdown,
    });
  }

  return {
    result,
    markdown,
    pullRequest: { number: pr.number, head: pr.head, base: pr.base },
    featureSpecPath: featureSpec ? featureSpecPath : null,
    comment,
  };
}

const FEATURE_BRANCH_RE = /^feature\/([a-z0-9][a-z0-9-]*)$/;

function featureSpecPathFromBranch(branch: string): string | null {
  const match = branch.match(FEATURE_BRANCH_RE);
  if (!match) return null;
  return `.ai/specs/${match[1]}.yaml`;
}
