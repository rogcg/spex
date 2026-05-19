import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { InvalidAiConfigError, type LLMProvider, loadAiConfig } from '@spex/core';
import {
  BranchPushError,
  type FeaturePrInput,
  type FixPrInput,
  type GitHubPullRequest,
  type PrCommitInfo,
  buildPrTemplate,
  createGitHubClient,
  openPullRequestFlow,
  polishPrDescription,
} from '@spex/integrations-github';
import { STRINGS } from '../strings.js';

const TECH_SPEC_RELATIVE_PATH = '.ai/tech-spec.yaml';

export interface RunGithubPrStepCommon {
  projectDir: string;
  branch: string;
  commits: readonly PrCommitInfo[];
  llm: LLMProvider;
}

export type RunGithubPrStepOptions =
  | (RunGithubPrStepCommon & {
      kind: 'feature';
      feature: Omit<
        FeaturePrInput,
        'kind' | 'branch' | 'baseBranch' | 'commits' | 'techSpecRelativePath'
      >;
      autoLabel: 'feature';
    })
  | (RunGithubPrStepCommon & {
      kind: 'fix';
      fix: Omit<FixPrInput, 'kind' | 'branch' | 'baseBranch' | 'commits' | 'techSpecRelativePath'>;
      autoLabel: 'fix';
    });

export interface RunGithubPrStepResult {
  status: 'opened' | 'skipped';
  pullRequest?: GitHubPullRequest;
  appliedLabels?: readonly string[];
}

/**
 * Optional Phase: open a GitHub PR for the just-created branch + commits.
 *
 * Returns `{ status: 'skipped' }` for any "non-error skip" condition
 * (config missing, integration disabled, no token, no commits).
 * Returns `{ status: 'opened', pullRequest, appliedLabels }` on success.
 * Logs all user-facing messages internally; on irrecoverable errors (push
 * failed, PR creation failed), logs the error and sets process.exitCode = 1
 * but does NOT throw — the caller has already committed the work locally.
 */
export async function runGithubPrStep(
  options: RunGithubPrStepOptions,
): Promise<RunGithubPrStepResult> {
  if (options.commits.length === 0) {
    console.log(STRINGS.githubPr.noCommitsToPush);
    return { status: 'skipped' };
  }

  let config: Awaited<ReturnType<typeof loadAiConfig>>;
  try {
    config = await loadAiConfig({ projectDir: options.projectDir });
  } catch (cause) {
    if (cause instanceof InvalidAiConfigError) {
      console.log(STRINGS.githubPr.invalidConfig(cause.issues));
      return { status: 'skipped' };
    }
    throw cause;
  }

  const gh = config?.integrations?.github;
  if (!gh) {
    console.log(STRINGS.githubPr.integrationNotConfigured);
    return { status: 'skipped' };
  }
  if (!gh.auto_create_pr) {
    console.log(STRINGS.githubPr.autoCreatePrDisabled);
    return { status: 'skipped' };
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token || token.length === 0) {
    console.log(STRINGS.githubPr.missingToken);
    return { status: 'skipped' };
  }

  const techSpecRelativePath = (await fileExists(join(options.projectDir, TECH_SPEC_RELATIVE_PATH)))
    ? TECH_SPEC_RELATIVE_PATH
    : null;

  const template =
    options.kind === 'feature'
      ? buildPrTemplate({
          kind: 'feature',
          ...options.feature,
          branch: options.branch,
          baseBranch: gh.base_branch,
          commits: options.commits,
          techSpecRelativePath,
        })
      : buildPrTemplate({
          kind: 'fix',
          ...options.fix,
          branch: options.branch,
          baseBranch: gh.base_branch,
          commits: options.commits,
          techSpecRelativePath,
        });

  console.log(STRINGS.githubPr.polishingDescription);
  const description = await polishPrDescription({ llm: options.llm, template });

  const client = createGitHubClient({ token });
  const labels = [...gh.pr_labels, options.autoLabel];

  console.log(STRINGS.githubPr.pushing(options.branch, gh.owner, gh.repo));
  try {
    console.log(STRINGS.githubPr.creating(gh.base_branch));
    const flowResult = await openPullRequestFlow({
      client,
      projectDir: options.projectDir,
      owner: gh.owner,
      repo: gh.repo,
      branch: options.branch,
      baseBranch: gh.base_branch,
      token,
      host: gh.host,
      title: description.title,
      body: description.body,
      labels,
    });
    console.log(
      STRINGS.githubPr.created({
        url: flowResult.pullRequest.htmlUrl,
        number: flowResult.pullRequest.number,
        labels: flowResult.appliedLabels,
      }),
    );
    return {
      status: 'opened',
      pullRequest: flowResult.pullRequest,
      appliedLabels: flowResult.appliedLabels,
    };
  } catch (cause) {
    if (cause instanceof BranchPushError) {
      console.error(STRINGS.githubPr.pushFailed(cause.message));
    } else {
      console.error(
        STRINGS.githubPr.createFailed(cause instanceof Error ? cause.message : String(cause)),
      );
    }
    process.exitCode = 1;
    return { status: 'skipped' };
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
