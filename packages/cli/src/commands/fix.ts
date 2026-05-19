import { resolve } from 'node:path';
import { confirm, select } from '@inquirer/prompts';
import {
  AnthropicProvider,
  BranchAlreadyExistsError,
  type CodebaseContext,
  DirtyWorkingTreeError,
  type LLMProvider,
  MissingApiKeyError,
  NotAGitRepoError,
  type RunFixFlowResult,
  assertCleanWorkingTree,
  buildCodebaseContext,
  buildFixBranchSlug,
  buildFixCommitMessage,
  commitPaths,
  createBranch,
  defaultBranchName,
  detectTestingFramework,
  revertFixDiff,
  runFixFlow,
} from '@spex/core';
import {
  type PostHogBugSource,
  buildPostHogBugSource,
  createPostHogMcpClient,
} from '@spex/integrations-posthog';
import type {
  BugErrorInfo,
  ErrorReference,
  FixOption,
  FixProposal,
  Hypothesis,
  HypothesisList,
  RegressionTest,
  RootCauseAnalysis,
} from '@spex/schemas';
import { STRINGS } from '../strings.js';
import { runGithubPrStep } from './github-pr.js';

export interface FixCommandOptions {
  affected?: readonly string[];
  errorMessage?: string;
  errorStack?: string;
  auto?: boolean;
  dryRun?: boolean;
  noGit?: boolean;
  fromError?: string;
}

export interface ParsedFromError {
  source: ErrorReference['source'];
  id: string;
}

/**
 * Parse the `--from-error` value. Accepts `posthog:<id>` or a bare `<id>`
 * (defaults to `posthog`). Returns the source + id; throws when the prefix
 * is recognised but unsupported, or when the value is empty.
 */
export function parseFromError(raw: string): ParsedFromError {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('--from-error value is empty');
  }
  const colon = trimmed.indexOf(':');
  if (colon === -1) {
    return { source: 'posthog', id: trimmed };
  }
  const prefix = trimmed.slice(0, colon).toLowerCase();
  const id = trimmed.slice(colon + 1).trim();
  if (id.length === 0) {
    throw new Error(`--from-error value "${raw}" is missing an id after the prefix`);
  }
  if (prefix === 'posthog') return { source: 'posthog', id };
  // Other sources (github, sentry, …) are recognised as identifiers but not
  // yet wired through to a fetch path — caller surfaces the error.
  throw new UnsupportedFromErrorSourceError(prefix);
}

export class UnsupportedFromErrorSourceError extends Error {
  readonly source: string;
  constructor(source: string) {
    super(`--from-error source "${source}" is not supported yet`);
    this.source = source;
  }
}

export async function runFixCommand(
  description: string | undefined,
  options: FixCommandOptions = {},
): Promise<void> {
  let fromErrorParsed: ParsedFromError | null = null;
  if (options.fromError && options.fromError.trim().length > 0) {
    try {
      fromErrorParsed = parseFromError(options.fromError);
    } catch (cause) {
      if (cause instanceof UnsupportedFromErrorSourceError) {
        console.error(STRINGS.fixCommand.fromErrorUnsupportedSource(cause.source));
      } else {
        console.error(
          STRINGS.errors.generic(cause instanceof Error ? cause.message : String(cause)),
        );
      }
      process.exitCode = 1;
      return;
    }
  }

  const hasDescription = description !== undefined && description.trim().length > 0;
  if (fromErrorParsed && hasDescription) {
    console.error(STRINGS.fixCommand.fromErrorAndDescriptionConflict);
    process.exitCode = 1;
    return;
  }
  if (!fromErrorParsed && !hasDescription) {
    console.error(STRINGS.fixCommand.missingDescription);
    process.exitCode = 1;
    return;
  }

  if (fromErrorParsed && fromErrorParsed.source === 'posthog') {
    if ((process.env.POSTHOG_API_KEY ?? '').length === 0) {
      console.error(STRINGS.fixCommand.fromErrorMissingPosthogApiKey);
      process.exitCode = 1;
      return;
    }
  }

  let posthogBugSource: PostHogBugSource | null = null;
  let effectiveDescription = description?.trim() ?? '';
  let effectiveError: BugErrorInfo | undefined;
  let errorReference: ErrorReference | undefined;
  if (fromErrorParsed && fromErrorParsed.source === 'posthog') {
    console.log(STRINGS.fixCommand.fromErrorFetching(fromErrorParsed.id));
    try {
      const posthog = await createPostHogMcpClient();
      try {
        posthogBugSource = await buildPostHogBugSource({
          client: posthog,
          issueId: fromErrorParsed.id,
        });
      } finally {
        await posthog.close();
      }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      console.error(STRINGS.fixCommand.fromErrorFetchFailed(fromErrorParsed.id, reason));
      process.exitCode = 1;
      return;
    }
    effectiveDescription = posthogBugSource.description;
    effectiveError = buildBugErrorInfo(posthogBugSource);
    errorReference = { source: 'posthog', id: fromErrorParsed.id };
    console.log(
      STRINGS.fixCommand.fromErrorFetched({
        id: fromErrorParsed.id,
        occurrences: posthogBugSource.issue.occurrences,
        affectedUsers: posthogBugSource.issue.affectedUsers,
        recordings: posthogBugSource.sessionRecordingUrls.length,
      }),
    );
  }

  // Merge CLI-provided --error-message / --error-stack on top of any source-
  // derived error info so explicit flags still win.
  if (options.errorMessage || options.errorStack) {
    effectiveError = {
      ...(effectiveError ?? {}),
      ...(options.errorMessage ? { message: options.errorMessage } : {}),
      ...(options.errorStack ? { stack: options.errorStack } : {}),
    };
  }

  const projectDir = resolve(process.cwd());
  const dryRun = options.dryRun === true;
  const auto = options.auto === true;
  const gitEnabled = options.noGit !== true && !dryRun;

  // Pre-flight: LLM
  let llm: LLMProvider;
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

  // Pre-flight: git state
  if (gitEnabled) {
    try {
      await assertCleanWorkingTree(projectDir);
    } catch (cause) {
      if (cause instanceof NotAGitRepoError) {
        console.error(STRINGS.fixCommand.notAGitRepo);
        process.exitCode = 1;
        return;
      }
      if (cause instanceof DirtyWorkingTreeError) {
        console.error(STRINGS.fixCommand.dirtyWorkingTree(cause.entries));
        process.exitCode = 1;
        return;
      }
      throw cause;
    }
  }

  console.log(STRINGS.fixCommand.aboutToDebug(effectiveDescription));
  if (auto) {
    console.log(STRINGS.fixCommand.autoModeWarning);
  }

  // Phase 1: print a quick context summary (we re-read inside runFixFlow,
  // but printing here gives the user a fast sanity check).
  console.log(STRINGS.fixCommand.phase1Header);
  let codebaseContext: CodebaseContext;
  try {
    codebaseContext = await buildCodebaseContext({ projectDir });
  } catch (cause) {
    console.error(STRINGS.errors.generic(cause instanceof Error ? cause.message : String(cause)));
    process.exitCode = 1;
    return;
  }
  const framework = detectTestingFramework(codebaseContext.packageInfo);
  console.log(
    STRINGS.fixCommand.contextSummary({
      files: codebaseContext.relevantFiles.length,
      affected: options.affected?.length ?? 0,
      commits: 0,
      framework: framework.framework ?? '(not detected)',
    }),
  );

  let result: RunFixFlowResult;
  try {
    result = await runFixFlow({
      llm,
      projectDir,
      description: effectiveDescription,
      dryRun,
      ...(options.affected ? { affectedFiles: options.affected } : {}),
      ...(effectiveError ? { error: effectiveError } : {}),
      ...(errorReference ? { errorReference } : {}),
      selectHypothesis: makeSelectHypothesis(auto),
      approveRootCause: makeApproveRootCause(auto),
      selectFixOption: makeSelectFixOption(auto),
      approveRegressionTest: makeApproveRegressionTest(auto),
    });
  } catch (cause) {
    console.error(STRINGS.errors.generic(cause instanceof Error ? cause.message : String(cause)));
    process.exitCode = 1;
    return;
  }

  if (result.dryRun) {
    console.log('\n=== Selected hypothesis ===');
    console.log(formatHypothesis(result.selectedHypothesis));
    console.log('\n=== Root cause ===');
    console.log(result.rootCauseAnalysis.rootCause);
    console.log('\n=== Recommended fix option ===');
    console.log(formatFixOption(result.selectedOption));
    console.log('\n=== Regression test ===');
    console.log(`  path: ${result.regressionTest.path}`);
    console.log(`  framework: ${result.regressionTest.framework}`);
    console.log(STRINGS.fixCommand.dryRunDone);
    return;
  }

  console.log(STRINGS.fixCommand.phase6Header);
  console.log(STRINGS.fixCommand.verifierBefore(result.verifierResult?.beforeRun.exitCode ?? null));
  console.log(STRINGS.fixCommand.verifierAfter(result.verifierResult?.afterRun.exitCode ?? null));

  // Phase 7: branch + commit (when git enabled)
  let branchName: string | null = null;
  let commitSha: string | null = null;
  if (gitEnabled && result.appliedFix) {
    const slug = buildFixBranchSlug({
      rootCause: result.rootCauseAnalysis,
      recommendedOption: result.selectedOption,
    });
    branchName = defaultBranchName(slug, 'fix/');
    console.log(STRINGS.fixCommand.creatingBranch(branchName));
    try {
      await createBranch({ projectDir, branch: branchName });
    } catch (cause) {
      // Branch creation failed — revert the fix to leave the project clean.
      await revertFixDiff(result.appliedFix.snapshots);
      if (cause instanceof BranchAlreadyExistsError) {
        console.error(STRINGS.errors.generic(cause.message));
      } else {
        console.error(
          STRINGS.errors.generic(cause instanceof Error ? cause.message : String(cause)),
        );
      }
      process.exitCode = 1;
      return;
    }

    const message = buildFixCommitMessage({
      hypothesis: result.selectedHypothesis,
      rootCause: result.rootCauseAnalysis,
      fixProposal: { ...result.fixProposal, recommended: result.selectedOption.id },
    });
    try {
      const commit = await commitPaths({
        projectDir,
        paths: result.affectedPaths,
        message,
      });
      commitSha = commit.sha;
      console.log(STRINGS.fixCommand.committing(commit.sha));
    } catch (cause) {
      console.error(STRINGS.errors.generic(cause instanceof Error ? cause.message : String(cause)));
      process.exitCode = 1;
      return;
    }

    await runGithubPrStep({
      kind: 'fix',
      projectDir,
      branch: branchName,
      commits: [{ sha: commitSha, subject: firstLine(message) }],
      llm,
      autoLabel: 'fix',
      fix: {
        hypothesisDescription: result.selectedHypothesis.description,
        rootCauseSummary: result.rootCauseAnalysis.rootCause,
        selectedFixLabel: result.selectedOption.label,
        selectedFixScope: result.selectedOption.scope,
        selectedFixRisk: result.selectedOption.risk,
        regressionTestPath: result.regressionTest.path,
        ...(posthogBugSource
          ? {
              posthogIssue: {
                id: posthogBugSource.issue.id,
                url: posthogBugSource.issue.url,
                name: posthogBugSource.issue.name,
                occurrences: posthogBugSource.issue.occurrences,
                affectedUsers: posthogBugSource.issue.affectedUsers,
                firstSeen: posthogBugSource.issue.firstSeen,
                sessionRecordingUrls: posthogBugSource.sessionRecordingUrls,
              },
            }
          : {}),
      },
    });
  }

  console.log(STRINGS.fixCommand.success({ branch: branchName, commit: commitSha }));
}

function firstLine(message: string): string {
  return message.split('\n', 1)[0] ?? message;
}

function buildBugErrorInfo(source: PostHogBugSource): BugErrorInfo | undefined {
  const fields: BugErrorInfo = {
    firstOccurrence: source.firstOccurrence,
    ...(source.errorMessage ? { message: source.errorMessage } : {}),
    ...(source.errorStack ? { stack: source.errorStack } : {}),
  };
  // BugErrorInfoSchema requires at least one populated field; firstOccurrence
  // alone is enough, so this is always defined here. Keep the optional return
  // type to mirror the caller's contract.
  return fields;
}

function makeSelectHypothesis(auto: boolean): (list: HypothesisList) => Promise<Hypothesis> {
  return async (list) => {
    console.log(STRINGS.fixCommand.phase2Header);
    console.log(STRINGS.fixCommand.hypothesesPreviewStart);
    for (const h of list.hypotheses) {
      console.log(formatHypothesis(h));
      console.log('');
    }
    console.log(STRINGS.fixCommand.hypothesesPreviewEnd);
    if (auto) {
      const head = list.hypotheses[0];
      if (!head) throw new Error('empty hypothesis list');
      return head;
    }
    const id = await select({
      message: STRINGS.fixCommand.pickHypothesisPrompt,
      choices: list.hypotheses.map((h) => ({
        name: `${h.id}: ${h.description} (confidence=${h.confidence})`,
        value: h.id,
      })),
      default: list.hypotheses[0]?.id,
    });
    const picked = list.hypotheses.find((h) => h.id === id);
    if (!picked) throw new Error(`Selected hypothesis not found: ${id}`);
    return picked;
  };
}

function makeApproveRootCause(auto: boolean): (analysis: RootCauseAnalysis) => Promise<boolean> {
  return async (analysis) => {
    console.log(STRINGS.fixCommand.rootCausePreviewStart);
    console.log(analysis.rootCause);
    console.log('');
    for (const e of analysis.evidence) {
      console.log(`  ${e.file}:${e.lines} — ${e.explanation}`);
    }
    console.log(STRINGS.fixCommand.rootCausePreviewEnd);
    if (auto) return true;
    return confirm({
      message: STRINGS.fixCommand.confirmApproveRootCause,
      default: true,
    });
  };
}

function makeSelectFixOption(auto: boolean): (proposal: FixProposal) => Promise<FixOption> {
  return async (proposal) => {
    console.log(STRINGS.fixCommand.phase4Header);
    console.log(STRINGS.fixCommand.proposalPreviewStart);
    for (const opt of proposal.options) {
      const marker = opt.id === proposal.recommended ? ' (recommended)' : '';
      console.log(`# ${opt.id}: ${opt.label}${marker}`);
      console.log(formatFixOption(opt));
      console.log('');
    }
    console.log(`Recommendation rationale: ${proposal.recommendationRationale}`);
    console.log(STRINGS.fixCommand.proposalPreviewEnd);
    const recommended = proposal.options.find((o) => o.id === proposal.recommended);
    if (auto) {
      if (!recommended) throw new Error('proposal.recommended does not match any option');
      return recommended;
    }
    const id = await select({
      message: STRINGS.fixCommand.pickFixOptionPrompt,
      choices: proposal.options.map((o) => ({
        name: `${o.id}: ${o.label} (scope=${o.scope}, risk=${o.risk})${
          o.id === proposal.recommended ? ' [recommended]' : ''
        }`,
        value: o.id,
      })),
      default: proposal.recommended,
    });
    const picked = proposal.options.find((o) => o.id === id);
    if (!picked) throw new Error(`Selected option not found: ${id}`);
    return picked;
  };
}

function makeApproveRegressionTest(auto: boolean): (test: RegressionTest) => Promise<boolean> {
  return async (test) => {
    console.log(STRINGS.fixCommand.phase5Header);
    console.log(STRINGS.fixCommand.regressionTestPreviewStart);
    console.log(`path: ${test.path}`);
    console.log(`framework: ${test.framework}`);
    console.log(`rationale: ${test.rationale}`);
    console.log('--- content ---');
    console.log(test.content);
    console.log(STRINGS.fixCommand.regressionTestPreviewEnd);
    if (auto) return true;
    return confirm({
      message: STRINGS.fixCommand.confirmApproveRegressionTest,
      default: true,
    });
  };
}

function formatHypothesis(h: Hypothesis): string {
  return [
    `# ${h.id}: ${h.description} (confidence=${h.confidence})`,
    '  evidence:',
    ...h.evidence.map((e) => `    - ${e}`),
    `  proposed diagnostic: ${h.proposedDiagnostic}`,
  ].join('\n');
}

function formatFixOption(opt: FixOption): string {
  return [
    `  scope=${opt.scope}, risk=${opt.risk}`,
    `  rationale: ${opt.rationale}`,
    '  --- diff ---',
    opt.diff,
  ].join('\n');
}
