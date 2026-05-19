import { resolve } from 'node:path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  AnthropicProvider,
  BranchAlreadyExistsError,
  type CodebaseContext,
  DirtyWorkingTreeError,
  type ExecutorResult,
  type LLMProvider,
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
  generateFeatureSpec,
  generateImplementationPlan,
  validatePlanIntegrity,
  writeFeatureSpec,
} from '@spex/core';
import type { FeatureSpec, ImplementationPlan } from '@spex/schemas';
import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolDependencies,
  errorResult,
  jsonTextResult,
} from './types.js';

export const SpexImplementInputSchema = z.object({
  description: z.string().min(1, 'description is required'),
  project_dir: z.string().optional(),
  dry_run: z.boolean().optional().default(false),
  no_git: z.boolean().optional().default(false),
});

export type SpexImplementInput = z.infer<typeof SpexImplementInputSchema>;

const TOOL: Tool = {
  name: 'spex_implement',
  description:
    'Implement a single feature in an existing SPEX-managed project. Runs the full pipeline non-interactively: read codebase context → generate feature spec → generate implementation plan → execute → commit. Returns the spec, plan, applied operations, and commit SHAs.',
  inputSchema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description:
          'Plain-English description of the feature to implement (e.g. "add pagination to the user list").',
      },
      project_dir: {
        type: 'string',
        description:
          'Project root directory. Defaults to the server cwd. The directory must be inside a git repo unless no_git is true.',
      },
      dry_run: {
        type: 'boolean',
        description: 'Generate the spec and plan, but do NOT write any files or run git.',
        default: false,
      },
      no_git: {
        type: 'boolean',
        description:
          'Skip branch creation and commits. Files are written directly on the current branch.',
        default: false,
      },
    },
    required: ['description'],
  },
};

export const spexImplementToolDefinition: ToolDefinition = {
  tool: TOOL,
  handle: async (rawInput, deps) => {
    const parsed = SpexImplementInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return errorResult('Invalid input for spex_implement', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
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
        await assertCleanWorkingTree(projectDir);
      } catch (cause) {
        if (cause instanceof NotAGitRepoError) {
          return errorResult(cause.message, { projectDir });
        }
        if (cause instanceof DirtyWorkingTreeError) {
          return errorResult(cause.message, { entries: cause.entries });
        }
        throw cause;
      }
    }

    let context: CodebaseContext;
    try {
      context = await buildCodebaseContext({ projectDir });
    } catch (cause) {
      return errorResult(`Context discovery failed: ${formatError(cause)}`);
    }

    let featureSpec: FeatureSpec;
    try {
      featureSpec = await generateFeatureSpec({
        llm,
        description: input.description,
        context,
      });
    } catch (cause) {
      return errorResult(`Feature-spec generation failed: ${formatError(cause)}`);
    }

    let plan: ImplementationPlan;
    try {
      plan = await generateImplementationPlan({ llm, featureSpec, context });
      validatePlanIntegrity(plan, { featureSpec });
    } catch (cause) {
      return errorResult(`Plan generation failed: ${formatError(cause)}`);
    }

    if (input.dry_run) {
      const result = await executePlan({ projectDir, plan, mode: 'dry-run' });
      return jsonTextResult({
        status: 'success',
        dry_run: true,
        featureSpec,
        plan,
        wouldApply: result.applied.map((op) => ({
          order: op.order,
          kind: op.kind,
          path: op.path,
        })),
      });
    }

    let branchName: string | null = null;
    if (gitEnabled) {
      branchName = defaultBranchName(featureSpec.feature.slug);
      try {
        await createBranch({ projectDir, branch: branchName });
      } catch (cause) {
        if (cause instanceof BranchAlreadyExistsError) {
          return errorResult(cause.message, { branch: branchName });
        }
        throw cause;
      }
    }

    let featureSpecRelativePath: string;
    try {
      const written = await writeFeatureSpec({ projectDir, spec: featureSpec });
      featureSpecRelativePath = written.relativePath;
    } catch (cause) {
      return errorResult(`Failed to write feature spec: ${formatError(cause)}`);
    }

    let executorResult: ExecutorResult;
    try {
      executorResult = await executePlan({ projectDir, plan, mode: 'auto' });
    } catch (cause) {
      return errorResult(`Plan execution failed: ${formatError(cause)}`);
    }

    let commitShas: { feat?: string; test?: string } = {};
    if (gitEnabled) {
      const sourcePaths = new Set<string>([featureSpecRelativePath]);
      const testPaths: string[] = [];
      for (const op of executorResult.applied) {
        if (op.kind === 'test-create') {
          testPaths.push(op.path);
        } else {
          sourcePaths.add(op.path);
        }
      }
      const auditLog = executorResult.auditLogPath;
      if (auditLog) {
        const rel = auditLog.startsWith(`${projectDir}/`)
          ? auditLog.slice(projectDir.length + 1)
          : null;
        if (rel) sourcePaths.add(rel);
      }

      try {
        if (sourcePaths.size > 0) {
          const feat = await commitPaths({
            projectDir,
            paths: [...sourcePaths].sort(),
            message: buildFeatureCommitMessage(featureSpec),
          });
          commitShas = { feat: feat.sha };
        }
        if (testPaths.length > 0) {
          const test = await commitPaths({
            projectDir,
            paths: [...testPaths].sort(),
            message: buildTestsCommitMessage(featureSpec),
          });
          commitShas.test = test.sha;
        }
      } catch (cause) {
        return errorResult(`Commit failed: ${formatError(cause)}`);
      }
    }

    return jsonTextResult({
      status: 'success',
      dry_run: false,
      branch: branchName,
      featureSpec,
      plan,
      applied: executorResult.applied.map((op) => ({
        order: op.order,
        kind: op.kind,
        path: op.path,
      })),
      auditLog: executorResult.auditLogPath,
      commits: commitShas,
    });
  },
};

function formatError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
