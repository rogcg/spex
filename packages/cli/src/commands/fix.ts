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
import type {
  BugErrorInfo,
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

export async function runFixCommand(
  description: string | undefined,
  options: FixCommandOptions = {},
): Promise<void> {
  if (options.fromError) {
    console.error(STRINGS.fixCommand.fromErrorNotSupported);
    process.exitCode = 1;
    return;
  }
  if (!description || description.trim().length === 0) {
    console.error(STRINGS.fixCommand.missingDescription);
    process.exitCode = 1;
    return;
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

  console.log(STRINGS.fixCommand.aboutToDebug(description));
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

  const error: BugErrorInfo | undefined =
    options.errorMessage || options.errorStack
      ? {
          ...(options.errorMessage ? { message: options.errorMessage } : {}),
          ...(options.errorStack ? { stack: options.errorStack } : {}),
        }
      : undefined;

  let result: RunFixFlowResult;
  try {
    result = await runFixFlow({
      llm,
      projectDir,
      description,
      dryRun,
      ...(options.affected ? { affectedFiles: options.affected } : {}),
      ...(error ? { error } : {}),
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
      },
    });
  }

  console.log(STRINGS.fixCommand.success({ branch: branchName, commit: commitSha }));
}

function firstLine(message: string): string {
  return message.split('\n', 1)[0] ?? message;
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
