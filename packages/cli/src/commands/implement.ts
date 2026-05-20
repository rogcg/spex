import { resolve } from 'node:path';
import { confirm } from '@inquirer/prompts';
import {
  AnthropicProvider,
  BranchAlreadyExistsError,
  type CodebaseContext,
  DirtyWorkingTreeError,
  type ExecutorMode,
  type ExecutorResult,
  MissingApiKeyError,
  NotAGitRepoError,
  assertCleanWorkingTree,
  buildCodebaseContext,
  buildFeatureCommitMessage,
  buildTestsCommitMessage,
  commitPaths,
  createBranch,
  defaultBranchName,
  executePlan,
  featureSpecToYaml,
  generateFeatureSpec,
  generateImplementationPlan,
  validatePlanIntegrity,
  writeFeatureSpec,
} from '@spex/core';
import { type LinearIssue, createLinearMcpClient, getLinearIssue } from '@spex/integrations-linear';
import { STRINGS } from '../strings.js';
import { runGithubPrStep } from './github-pr.js';
import { collectCommitGroups, formatPlanForReview } from './implement-helpers.js';

export interface ImplementCommandOptions {
  auto?: boolean;
  dryRun?: boolean;
  noGit?: boolean;
  fromIssue?: string;
}

const LINEAR_ID_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;

export function isLinearIssueIdentifier(raw: string): boolean {
  return LINEAR_ID_PATTERN.test(raw);
}

export interface LinearIssueDescriptionSource {
  identifier: string;
  url: string;
  title: string;
  description: string;
}

/**
 * Merge a Linear issue's title and description into a single feature
 * description suitable for spec generation. Empty title or description are
 * tolerated; both empty surfaces as `null` so the caller can error out
 * cleanly.
 */
export function buildDescriptionFromLinearIssue(
  issue: LinearIssue,
): LinearIssueDescriptionSource | null {
  const title = issue.title.trim();
  const description = (issue.description ?? '').trim();
  if (title.length === 0 && description.length === 0) {
    return null;
  }
  let merged: string;
  if (title.length === 0) merged = description;
  else if (description.length === 0) merged = title;
  else merged = `${title}\n\n${description}`;
  return {
    identifier: issue.identifier,
    url: issue.url,
    title,
    description: merged,
  };
}

export async function runImplementCommand(
  description: string | undefined,
  options: ImplementCommandOptions = {},
): Promise<void> {
  const hasDescription = description !== undefined && description.trim().length > 0;
  const fromIssue = options.fromIssue?.trim();

  if (fromIssue && hasDescription) {
    console.error(STRINGS.implementCommand.fromIssueAndDescriptionConflict);
    process.exitCode = 1;
    return;
  }
  if (!fromIssue && !hasDescription) {
    console.error(STRINGS.implementCommand.missingDescription);
    process.exitCode = 1;
    return;
  }
  if (fromIssue && !isLinearIssueIdentifier(fromIssue)) {
    console.error(STRINGS.implementCommand.fromIssueInvalidFormat(fromIssue));
    process.exitCode = 1;
    return;
  }
  if (fromIssue && (process.env.LINEAR_API_KEY ?? '').length === 0) {
    console.error(STRINGS.implementCommand.fromIssueMissingApiKey);
    process.exitCode = 1;
    return;
  }

  let linearSource: LinearIssueDescriptionSource | null = null;
  let effectiveDescription = description ?? '';
  if (fromIssue) {
    console.log(STRINGS.implementCommand.fromIssueFetching(fromIssue));
    try {
      const linear = await createLinearMcpClient();
      try {
        const issue = await getLinearIssue({ client: linear, id: fromIssue });
        linearSource = buildDescriptionFromLinearIssue(issue);
        if (linearSource === null) {
          console.error(STRINGS.implementCommand.fromIssueEmptyBody(fromIssue));
          process.exitCode = 1;
          return;
        }
        effectiveDescription = linearSource.description;
        console.log(
          STRINGS.implementCommand.fromIssueFetched({
            identifier: linearSource.identifier,
            title: linearSource.title,
            url: linearSource.url,
          }),
        );
      } finally {
        await linear.close();
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(STRINGS.implementCommand.fromIssueFetchFailed(fromIssue, reason));
      process.exitCode = 1;
      return;
    }
  }

  const projectDir = resolve(process.cwd());
  const dryRun = options.dryRun === true;
  const auto = options.auto === true;
  const gitEnabled = options.noGit !== true && !dryRun;

  // Pre-flight: API key
  let llm: AnthropicProvider;
  try {
    llm = new AnthropicProvider();
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      console.error(STRINGS.errors.missingApiKey(error.envVar));
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  // Pre-flight: git state
  if (gitEnabled) {
    try {
      await assertCleanWorkingTree(projectDir);
    } catch (error) {
      if (error instanceof NotAGitRepoError) {
        console.error(STRINGS.implementCommand.notAGitRepo);
        process.exitCode = 1;
        return;
      }
      if (error instanceof DirtyWorkingTreeError) {
        console.error(STRINGS.implementCommand.dirtyWorkingTree(error.entries));
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  }

  console.log(STRINGS.implementCommand.aboutToImplement(effectiveDescription));
  if (auto) {
    console.log(STRINGS.implementCommand.autoModeWarning);
  }

  // Phase 1: codebase context
  console.log(STRINGS.implementCommand.phase1Header);
  const context = await buildCodebaseContext({ projectDir });
  console.log(STRINGS.implementCommand.contextSummary(buildContextSummary(context)));

  // Phase 2: feature spec
  console.log(STRINGS.implementCommand.phase2Header);
  const featureSpec = await generateFeatureSpec({
    llm,
    description: effectiveDescription,
    context,
  });
  console.log(STRINGS.implementCommand.featureSpecPreviewStart);
  console.log(featureSpecToYaml(featureSpec));
  console.log(STRINGS.implementCommand.featureSpecPreviewEnd);

  if (!auto) {
    const approved = await confirm({
      message: STRINGS.implementCommand.confirmApproveFeatureSpec,
      default: true,
    });
    if (!approved) {
      console.log(STRINGS.implementCommand.cancelled);
      return;
    }
  }

  // Phase 3: implementation plan
  console.log(STRINGS.implementCommand.phase3Header);
  const plan = await generateImplementationPlan({ llm, featureSpec, context });
  validatePlanIntegrity(plan, { featureSpec });
  console.log(STRINGS.implementCommand.planPreviewStart);
  console.log(formatPlanForReview(plan));
  console.log(STRINGS.implementCommand.planPreviewEnd);

  if (!auto) {
    const approved = await confirm({
      message: STRINGS.implementCommand.confirmApprovePlan,
      default: true,
    });
    if (!approved) {
      console.log(STRINGS.implementCommand.cancelled);
      return;
    }
  }

  // Phase 4: execute (branch first when git is enabled)
  const executorMode: ExecutorMode = dryRun ? 'dry-run' : auto ? 'auto' : 'step-by-step';
  console.log(STRINGS.implementCommand.phase4Header(executorMode));

  let branchName: string | null = null;
  if (gitEnabled) {
    branchName = defaultBranchName(featureSpec.feature.slug);
    console.log(STRINGS.implementCommand.creatingBranch(branchName));
    try {
      await createBranch({ projectDir, branch: branchName });
    } catch (error) {
      if (error instanceof BranchAlreadyExistsError) {
        console.error(STRINGS.implementCommand.branchExists(branchName));
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  }

  let featureSpecRelativePath: string | null = null;
  if (!dryRun) {
    const written = await writeFeatureSpec({ projectDir, spec: featureSpec });
    featureSpecRelativePath = written.relativePath;
    console.log(STRINGS.implementCommand.writingFeatureSpec(featureSpecRelativePath));
  }

  const executorResult: ExecutorResult = await executePlan({
    projectDir,
    plan,
    mode: executorMode,
    ...(executorMode === 'step-by-step'
      ? {
          onBeforeOperation: async (op) => {
            console.log(STRINGS.implementCommand.opAboutToApply(op.order, op.kind, op.path));
            const ok = await confirm({
              message: STRINGS.implementCommand.confirmApplyOperation,
              default: true,
            });
            if (!ok) {
              console.log(STRINGS.implementCommand.operationSkipped);
            } else {
              console.log(STRINGS.implementCommand.operationApplied);
            }
            return ok;
          },
        }
      : {}),
  });

  if (dryRun) {
    console.log(STRINGS.implementCommand.dryRunDone(executorResult.applied.length));
    return;
  }

  console.log(
    STRINGS.implementCommand.executionDone({
      applied: executorResult.applied.length,
      skipped: executorResult.skipped.length,
    }),
  );

  // Phase 5: commits
  if (!gitEnabled) {
    console.log(STRINGS.implementCommand.gitDisabled);
    console.log(
      STRINGS.implementCommand.success({
        branch: null,
        auditLog: executorResult.auditLogPath,
      }),
    );
    return;
  }

  console.log(STRINGS.implementCommand.phase5Header);
  const groups = collectCommitGroups({
    projectDir,
    executorResult,
    featureSpecRelativePath: featureSpecRelativePath ?? '',
  });

  const prCommits: { sha: string; subject: string }[] = [];
  if (groups.sourcePaths.length === 0 && groups.testPaths.length === 0) {
    console.log(STRINGS.implementCommand.noChangesToCommit);
  } else {
    if (groups.sourcePaths.length > 0) {
      const sourceMessage = buildFeatureCommitMessage(featureSpec);
      const sourceCommit = await commitPaths({
        projectDir,
        paths: groups.sourcePaths,
        message: sourceMessage,
      });
      console.log(STRINGS.implementCommand.committingChanges(sourceCommit.sha));
      prCommits.push({ sha: sourceCommit.sha, subject: firstLine(sourceMessage) });
    }
    if (groups.testPaths.length > 0) {
      const testMessage = buildTestsCommitMessage(featureSpec);
      const testCommit = await commitPaths({
        projectDir,
        paths: groups.testPaths,
        message: testMessage,
      });
      console.log(STRINGS.implementCommand.committingTests(testCommit.sha));
      prCommits.push({ sha: testCommit.sha, subject: firstLine(testMessage) });
    }
  }

  if (branchName !== null) {
    await runGithubPrStep({
      kind: 'feature',
      projectDir,
      branch: branchName,
      commits: prCommits,
      llm,
      autoLabel: 'feature',
      feature: {
        featureSlug: featureSpec.feature.slug,
        featureTitle: featureSpec.feature.title,
        featureDescription: featureSpec.feature.description,
        technicalApproach: featureSpec.technical_approach,
        testCases: featureSpec.test_cases,
        filesAffected: featureSpec.files_affected.map((f) => ({
          path: f.path,
          operation: f.operation,
        })),
        featureSpecRelativePath,
        ...(linearSource !== null
          ? { linearIssue: { identifier: linearSource.identifier, url: linearSource.url } }
          : {}),
      },
    });
  }

  console.log(
    STRINGS.implementCommand.success({
      branch: branchName,
      auditLog: executorResult.auditLogPath,
    }),
  );
}

function firstLine(message: string): string {
  return message.split('\n', 1)[0] ?? message;
}

function buildContextSummary(context: CodebaseContext): {
  files: number;
  truncated: boolean;
  excluded: number;
  framework: string;
  patterns: string;
} {
  const framework = context.techSpec
    ? context.techSpec.stack.label
    : '(no tech spec — using package.json and detection only)';
  const patterns = `naming=${context.detectedPatterns.fileNamingConvention}, components=${context.detectedPatterns.componentStructure}, tests=${context.detectedPatterns.testingPattern}`;
  return {
    files: context.relevantFiles.length,
    truncated: context.budget.truncated,
    excluded: context.budget.excludedFiles,
    framework,
    patterns,
  };
}
