import { resolve } from 'node:path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  AnthropicProvider,
  BranchAlreadyExistsError,
  type LLMProvider,
  MissingApiKeyError,
  NotAGitRepoError,
  type RunFixFlowResult,
  buildFixBranchSlug,
  buildFixCommitMessage,
  commitPaths,
  createBranch,
  defaultBranchName,
  runFixFlow,
} from '@spex/core';
import type { BugErrorInfo } from '@spex/schemas';
import { z } from 'zod';
import { type ToolDefinition, errorResult, jsonTextResult } from './types.js';

const ErrorInfoInputSchema = z
  .object({
    message: z.string().optional(),
    stack: z.string().optional(),
    firstOccurrence: z.string().optional(),
  })
  .optional();

export const SpexFixInputSchema = z.object({
  description: z.string().min(1, 'description is required'),
  project_dir: z.string().optional(),
  affected_files: z.array(z.string().min(1)).optional(),
  error: ErrorInfoInputSchema,
  dry_run: z.boolean().optional().default(false),
  no_git: z.boolean().optional().default(false),
  /**
   * Test runner override. The MCP host might not have vitest/jest on PATH;
   * pass `{ bin, args, appendTestPath }` to direct the regression-test
   * verifier at the right runner.
   */
  test_command: z
    .object({
      bin: z.string().min(1),
      args: z.array(z.string()).optional(),
      append_test_path: z.boolean().optional(),
    })
    .optional(),
});
export type SpexFixInput = z.infer<typeof SpexFixInputSchema>;

const TOOL: Tool = {
  name: 'spex_fix',
  description:
    'Diagnose and fix a bug in an existing SPEX-managed project. Runs the full pipeline non-interactively: context -> ranked hypotheses -> root-cause analysis (loops through up to 3 hypotheses if the first one is refuted) -> fix proposal -> regression test -> verify fail-then-pass -> commit. Returns the analysis, fix, regression test, and commit SHA. Refuses to run on a dirty working tree unless no_git is true.',
  inputSchema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'Plain-English description of the bug ("Pagination resets on filter change").',
      },
      project_dir: {
        type: 'string',
        description: 'Project root directory. Defaults to the server cwd.',
      },
      affected_files: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of project-relative file paths the bug appears to involve. Helps focus the analysis.',
      },
      error: {
        type: 'object',
        description: 'Optional structured error info (message, stack, firstOccurrence).',
        properties: {
          message: { type: 'string' },
          stack: { type: 'string' },
          firstOccurrence: { type: 'string' },
        },
      },
      dry_run: {
        type: 'boolean',
        description:
          'Generate the analysis, proposal, and regression test, but do NOT modify the filesystem or run git.',
        default: false,
      },
      no_git: {
        type: 'boolean',
        description: 'Skip the dirty-tree precheck, branch creation, and commits.',
        default: false,
      },
      test_command: {
        type: 'object',
        description:
          'Override the test runner used by the regression-test verifier. Pass when vitest/jest is not on the server PATH.',
        properties: {
          bin: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
          append_test_path: { type: 'boolean' },
        },
        required: ['bin'],
      },
    },
    required: ['description'],
  },
};

export const spexFixToolDefinition: ToolDefinition = {
  tool: TOOL,
  handle: async (rawInput, deps) => {
    const parsed = SpexFixInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return errorResult('Invalid input for spex_fix', {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const input = parsed.data;
    const projectDir = input.project_dir ? resolve(input.project_dir) : resolve(process.cwd());
    const gitEnabled = !input.no_git && !input.dry_run;

    let llm: LLMProvider;
    try {
      llm = deps.llm ?? new AnthropicProvider();
    } catch (cause) {
      if (cause instanceof MissingApiKeyError) {
        return errorResult(cause.message, { envVar: cause.envVar });
      }
      throw cause;
    }

    if (gitEnabled) {
      try {
        const { assertCleanWorkingTree } = await import('@spex/core');
        await assertCleanWorkingTree(projectDir);
      } catch (cause) {
        if (cause instanceof NotAGitRepoError) {
          return errorResult(cause.message, { projectDir });
        }
        if (cause instanceof Error) {
          return errorResult(cause.message);
        }
        throw cause;
      }
    }

    let branchName: string | null = null;
    if (gitEnabled) {
      // We don't have a slug yet (need the proposal first). Create the branch
      // AFTER the fix flow produces its proposal so the slug is meaningful.
    }

    let flowResult: RunFixFlowResult;
    try {
      const error: BugErrorInfo | undefined = input.error
        ? {
            ...(input.error.message ? { message: input.error.message } : {}),
            ...(input.error.stack ? { stack: input.error.stack } : {}),
            ...(input.error.firstOccurrence
              ? { firstOccurrence: input.error.firstOccurrence }
              : {}),
          }
        : undefined;
      const testCommand = input.test_command
        ? {
            bin: input.test_command.bin,
            ...(input.test_command.args ? { args: input.test_command.args } : {}),
            ...(input.test_command.append_test_path !== undefined
              ? { appendTestPath: input.test_command.append_test_path }
              : {}),
          }
        : undefined;

      flowResult = await runFixFlow({
        llm,
        projectDir,
        description: input.description,
        dryRun: input.dry_run,
        ...(input.affected_files ? { affectedFiles: input.affected_files } : {}),
        ...(error ? { error } : {}),
        ...(testCommand ? { testCommand } : {}),
      });
    } catch (cause) {
      return errorResult(cause instanceof Error ? cause.message : String(cause), {
        phase: 'fix-flow',
      });
    }

    if (flowResult.dryRun) {
      return jsonTextResult({
        status: 'success',
        dry_run: true,
        rootCause: flowResult.rootCauseAnalysis.rootCause,
        selectedHypothesis: flowResult.selectedHypothesis,
        fixProposal: flowResult.fixProposal,
        selectedOption: flowResult.selectedOption,
        regressionTest: flowResult.regressionTest,
        wouldAffectPaths: flowResult.affectedPaths,
      });
    }

    // Phase 8: git branch + commit (when git enabled). We do it AFTER the
    // fix-flow has produced its proposal so the branch slug is meaningful.
    let commitSha: string | undefined;
    if (gitEnabled && flowResult.appliedFix) {
      const slug = buildFixBranchSlug({
        rootCause: flowResult.rootCauseAnalysis,
        recommendedOption: flowResult.selectedOption,
      });
      branchName = defaultBranchName(slug, 'fix/');

      try {
        // Branch off main; if branch creation fails AFTER we've written the
        // fix + test, revert before reporting.
        await createBranch({ projectDir, branch: branchName });
      } catch (cause) {
        // Roll back to leave the project clean.
        const { revertFixDiff } = await import('@spex/core');
        await revertFixDiff(flowResult.appliedFix.snapshots);
        if (cause instanceof BranchAlreadyExistsError) {
          return errorResult(cause.message, { branch: branchName });
        }
        if (cause instanceof Error) return errorResult(cause.message);
        throw cause;
      }

      const message = buildFixCommitMessage({
        hypothesis: flowResult.selectedHypothesis,
        rootCause: flowResult.rootCauseAnalysis,
        fixProposal: { ...flowResult.fixProposal, recommended: flowResult.selectedOption.id },
      });
      const commit = await commitPaths({
        projectDir,
        paths: flowResult.affectedPaths,
        message,
      });
      commitSha = commit.sha;
    }

    return jsonTextResult({
      status: 'success',
      dry_run: false,
      branch: branchName,
      commit: commitSha ?? null,
      selectedHypothesis: flowResult.selectedHypothesis,
      hypothesisAttempts: flowResult.hypothesisAttempts,
      rootCause: flowResult.rootCauseAnalysis,
      selectedOption: {
        id: flowResult.selectedOption.id,
        label: flowResult.selectedOption.label,
        scope: flowResult.selectedOption.scope,
        risk: flowResult.selectedOption.risk,
      },
      regressionTest: {
        path: flowResult.regressionTest.path,
        framework: flowResult.regressionTest.framework,
      },
      verifierResult: flowResult.verifierResult,
      affectedPaths: flowResult.affectedPaths,
    });
  },
};
