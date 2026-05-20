import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  AnthropicProvider,
  type LLMProvider,
  MissingApiKeyError,
  type RunScaffoldOptions,
  type RunScaffoldResult,
  ScaffoldFailedError,
  generateTechSpec,
  injectAiFolder,
  recommendStack,
  runScaffold,
} from '@spex/core';
import type { StackDecision, TechSpec } from '@spex/schemas';
import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolDependencies,
  errorResult,
  jsonTextResult,
} from './types.js';

const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const SpexNewInputSchema = z.object({
  name: z
    .string()
    .min(1, 'project name is required')
    .regex(
      PROJECT_NAME_PATTERN,
      'project name must be lowercase letters, digits, and dashes (e.g. "my-saas")',
    ),
  project_type: z.string().min(1, 'project_type is required'),
  primary_users: z.string().default('Internal team'),
  expected_scale: z.string().default('Less than 100 users'),
  auth_requirements: z.string().default('None'),
  data_persistence: z.string().default('Simple key-value'),
  /**
   * Optional explicit stack label. If supplied, the user's choice is honored
   * (validation warnings, if any, are logged but do not block). If omitted, the
   * recommender's top-ranked stack is selected automatically.
   */
  stack: z.string().optional(),
  /**
   * Where to create the project. Defaults to `process.cwd()`. The MCP host
   * typically passes the user's workspace root here.
   */
  parent_dir: z.string().optional(),
});

export type SpexNewInput = z.infer<typeof SpexNewInputSchema>;

export interface SpexNewDependencies extends ToolDependencies {
  /**
   * Override for the dynamic scaffold runner. Tests stub this to avoid spawning
   * real CLIs and network I/O.
   */
  scaffold?: (options: RunScaffoldOptions) => Promise<RunScaffoldResult>;
}

const TOOL: Tool = {
  name: 'spex_new',
  description:
    'Create a new SPEX-managed project from scratch. The AI recommends a best-fit stack from the supplied discovery answers (or honors the optional `stack` argument), generates a tech-spec, plans the scaffold dynamically, executes it with a verification + self-correction loop, then injects a .ai/ folder. Non-interactive: pass all discovery answers upfront.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Project directory name. Lowercase letters, digits, and dashes only.',
      },
      project_type: {
        type: 'string',
        description:
          'What kind of application is being built (e.g. "task tracker", "internal admin tool").',
      },
      primary_users: {
        type: 'string',
        description:
          'Who the primary users are. Common values: Consumers (B2C), Small businesses (SMB), Enterprise, Internal team, Developers.',
      },
      expected_scale: {
        type: 'string',
        description:
          'Expected scale in the first year. Common values: Less than 100 users, 100-1000 users, 1000-10000 users, More than 10000 users.',
      },
      auth_requirements: {
        type: 'string',
        description:
          'Authentication requirements. Common values: None, Email/password only, OAuth (Google, GitHub, etc.), Multi-tenant with SSO.',
      },
      data_persistence: {
        type: 'string',
        description:
          'Data persistence needs. Common values: No backend (static site), Simple key-value, Relational database, Multi-source complex data.',
      },
      stack: {
        type: 'string',
        description:
          'Optional explicit stack label (e.g. "Next.js + Postgres + Drizzle"). When omitted, the recommender chooses.',
      },
      parent_dir: {
        type: 'string',
        description: 'Directory in which to create the project. Defaults to the server cwd.',
      },
    },
    required: ['name', 'project_type'],
  },
};

export const spexNewToolDefinition: ToolDefinition = {
  tool: TOOL,
  handle: async (rawInput, deps) => {
    const parsed = SpexNewInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return errorResult('Invalid input for spex_new', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const input = parsed.data;
    const parentDir = input.parent_dir ? resolve(input.parent_dir) : resolve(process.cwd());
    const projectDir = resolve(parentDir, input.name);

    if (existsSync(projectDir)) {
      return errorResult(`Directory already exists: ${projectDir}`, { projectDir });
    }

    let llm: LLMProvider;
    try {
      llm = deps.llm ?? new AnthropicProvider();
    } catch (cause) {
      if (cause instanceof MissingApiKeyError) {
        return errorResult(cause.message, { envVar: cause.envVar });
      }
      throw cause;
    }

    const answers = {
      project_type: input.project_type,
      primary_users: input.primary_users,
      expected_scale: input.expected_scale,
      auth_requirements: input.auth_requirements,
      data_persistence: input.data_persistence,
    };

    let decision: StackDecision;
    try {
      decision = await pickStackDecision({
        llm,
        projectName: input.name,
        answers,
        ...(input.stack ? { explicitChoice: input.stack } : {}),
      });
    } catch (cause) {
      return errorResult(`Stack selection failed: ${formatError(cause)}`);
    }

    let techSpec: TechSpec;
    try {
      techSpec = await generateTechSpec({ llm, projectName: input.name, answers, decision });
    } catch (cause) {
      return errorResult(`Tech-spec generation failed: ${formatError(cause)}`);
    }

    const scaffold = deps.scaffold ?? runScaffold;
    let scaffoldResult: RunScaffoldResult;
    try {
      scaffoldResult = await scaffold({
        llm,
        projectName: input.name,
        parentDir,
        projectDir,
        decision,
      });
    } catch (cause) {
      if (cause instanceof ScaffoldFailedError) {
        await rm(projectDir, { recursive: true, force: true }).catch(() => {});
        return errorResult('Scaffold failed after self-correction attempts.', {
          attempts: cause.attempts.map((a) => ({
            attempt: a.attempt,
            ok: a.verification.ok,
            failedPostConditions: a.verification.failedPostConditions,
          })),
        });
      }
      return errorResult(`Scaffold failed: ${formatError(cause)}`);
    }

    try {
      await injectAiFolder({ projectDir, spec: techSpec });
    } catch (cause) {
      return errorResult(`.ai/ injection failed: ${formatError(cause)}`);
    }

    return jsonTextResult({
      status: 'success',
      projectDir,
      techSpec,
      scaffold: {
        attempts: scaffoldResult.attempts.length,
        stackLabel: scaffoldResult.plan.stackLabel,
      },
      filesCreated: ['.ai/tech-spec.yaml', '.ai/README.md'],
    });
  },
};

interface PickStackDecisionArgs {
  llm: LLMProvider;
  projectName: string;
  answers: Record<string, string>;
  explicitChoice?: string;
}

async function pickStackDecision(args: PickStackDecisionArgs): Promise<StackDecision> {
  const recs = await recommendStack({
    llm: args.llm,
    projectName: args.projectName,
    answers: args.answers,
    ...(args.explicitChoice
      ? {
          explicitConstraints: `User explicitly requested this stack: ${args.explicitChoice}. Use exactly this label/components in the primary recommendation.`,
        }
      : {}),
  });
  const primary = recs.recommendations[0];
  if (!primary) {
    throw new Error('Recommendation engine returned no recommendations.');
  }
  const warnings = [...primary.requirementsUnaddressed, ...recs.unmappedRequirements];
  const source = args.explicitChoice ? 'user' : 'recommended';
  const rationale = args.explicitChoice
    ? `User-chosen stack: ${args.explicitChoice}. Selected ${primary.label} (confidence ${primary.confidence}).`
    : `Selected ${primary.label} — confidence ${primary.confidence}. Covers: ${primary.requirementsCovered.join(', ')}.`;
  return {
    label: primary.label,
    source,
    components: primary.components,
    rationale,
    tradeoffs: primary.tradeoffs,
    validationWarnings: warnings,
  };
}

function formatError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
