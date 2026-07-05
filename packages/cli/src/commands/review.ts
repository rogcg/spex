import { resolve } from 'node:path';
import { confirm } from '@inquirer/prompts';
import {
  AnthropicProvider,
  InvalidAiConfigError,
  MissingApiKeyError,
  loadAiConfig,
} from '@spex/core';
import { createGitHubClient, runReviewFlow } from '@spex/integrations-github';
import { suggestNextSteps } from '../flows/suggest-next.js';
import { STRINGS } from '../strings.js';
import { InvalidPrRefError, parsePrRef } from './review-ref.js';

export interface ReviewCommandOptions {
  auto?: boolean;
  dryRun?: boolean;
}

export async function runReviewCommand(
  ref: string | undefined,
  options: ReviewCommandOptions = {},
): Promise<void> {
  if (!ref || ref.trim().length === 0) {
    console.error(STRINGS.reviewCommand.missingRef);
    process.exitCode = 1;
    return;
  }

  const projectDir = resolve(process.cwd());
  const auto = options.auto === true;
  const dryRun = options.dryRun === true;

  let parsed: ReturnType<typeof parsePrRef>;
  try {
    parsed = parsePrRef(ref);
  } catch (cause) {
    if (cause instanceof InvalidPrRefError) {
      console.error(STRINGS.errors.generic(cause.message));
      process.exitCode = 1;
      return;
    }
    throw cause;
  }

  let owner = parsed.owner;
  let repo = parsed.repo;
  let host = 'github.com';
  let reviewMode: 'single' | 'split' = 'single';

  try {
    const config = await loadAiConfig({ projectDir });
    const gh = config?.integrations?.github;
    if (gh) {
      host = gh.host;
      reviewMode = gh.review_mode;
      if (owner === null) owner = gh.owner;
      if (repo === null) repo = gh.repo;
    }
  } catch (cause) {
    if (cause instanceof InvalidAiConfigError) {
      console.error(STRINGS.githubPr.invalidConfig(cause.issues));
      process.exitCode = 1;
      return;
    }
    throw cause;
  }

  if (owner === null || repo === null) {
    console.error(STRINGS.reviewCommand.missingOwnerRepo);
    process.exitCode = 1;
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token || token.length === 0) {
    console.error(STRINGS.reviewCommand.missingToken);
    process.exitCode = 1;
    return;
  }

  let llm: AnthropicProvider;
  try {
    llm = new AnthropicProvider();
  } catch (cause) {
    if (cause instanceof MissingApiKeyError) {
      console.error(STRINGS.errors.missingApiKey(cause.envVar));
      process.exitCode = 1;
      return;
    }
    throw cause;
  }

  const client = createGitHubClient({ token });

  console.log(STRINGS.reviewCommand.fetchingPr(parsed.number, owner, repo));
  if (host !== 'github.com') {
    console.log(STRINGS.reviewCommand.usingHost(host));
  }
  console.log(STRINGS.reviewCommand.generating(reviewMode));

  const flow = await runReviewFlow({
    client,
    llm,
    projectDir,
    owner,
    repo,
    prNumber: parsed.number,
    reviewMode,
    shouldPost: async (markdown) => {
      console.log(STRINGS.reviewCommand.previewStart);
      console.log(markdown);
      console.log(STRINGS.reviewCommand.previewEnd);
      if (dryRun) {
        console.log(STRINGS.reviewCommand.dryRunDone);
        return false;
      }
      if (auto) return true;
      const yes = await confirm({
        message: STRINGS.reviewCommand.confirmPost(parsed.number),
        default: true,
      });
      if (!yes) console.log(STRINGS.reviewCommand.cancelled);
      return yes;
    },
  });

  if (flow.featureSpecPath) {
    console.log(STRINGS.reviewCommand.foundFeatureSpec(flow.featureSpecPath));
  }
  if (flow.comment) {
    console.log(STRINGS.reviewCommand.posted(flow.comment.htmlUrl));
    await suggestNextSteps({
      llm,
      context: {
        command: 'review',
        outcome: 'Review comment posted to the pull request on GitHub',
        facts: [`Recommendation: ${flow.result.recommendation}`],
      },
    });
  }
}
