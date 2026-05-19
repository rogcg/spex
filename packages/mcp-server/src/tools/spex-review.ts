import { resolve } from 'node:path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { AnthropicProvider, type LLMProvider, MissingApiKeyError, loadAiConfig } from '@spex/core';
import {
  MissingGitHubTokenError,
  createGitHubClient,
  runReviewFlow,
} from '@spex/integrations-github';
import { z } from 'zod';
import { type ToolDefinition, errorResult, jsonTextResult } from './types.js';

const PR_NUMBER_RE = /^\d+$/;
const PR_URL_RE = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/;

export const SpexReviewInputSchema = z.object({
  pr_ref: z.string().min(1, 'pr_ref is required (PR number or full GitHub PR URL)'),
  project_dir: z.string().optional(),
  /** Override .ai/config.yaml. Required when pr_ref is a bare number and no config exists. */
  owner: z.string().optional(),
  repo: z.string().optional(),
  /** Override .ai/config.yaml review_mode. Defaults to 'single'. */
  review_mode: z.enum(['single', 'split']).optional(),
  /** When true, post the review comment to the PR. Default false (preview only). */
  auto_post: z.boolean().optional().default(false),
});
export type SpexReviewInput = z.infer<typeof SpexReviewInputSchema>;

const TOOL: Tool = {
  name: 'spex_review',
  description:
    'Review a GitHub PR against its linked feature spec, the project tech spec, and detected codebase conventions. Returns a structured review (spec_compliance, conventions, performance_security, test_coverage, recommendation) plus a rendered Markdown comment. Optionally posts the comment to the PR. Requires GITHUB_TOKEN.',
  inputSchema: {
    type: 'object',
    properties: {
      pr_ref: {
        type: 'string',
        description:
          'PR number (e.g. "42") or full PR URL (https://github.com/owner/repo/pull/42).',
      },
      project_dir: {
        type: 'string',
        description: 'Project root directory. Defaults to the server cwd.',
      },
      owner: {
        type: 'string',
        description:
          'Repo owner. Overrides .ai/config.yaml; required when pr_ref is a bare number with no config.',
      },
      repo: {
        type: 'string',
        description:
          'Repo name. Overrides .ai/config.yaml; required when pr_ref is a bare number with no config.',
      },
      review_mode: {
        type: 'string',
        enum: ['single', 'split'],
        description: 'Review mode override. Defaults to value from .ai/config.yaml or "single".',
      },
      auto_post: {
        type: 'boolean',
        description: 'Post the review as a comment on the PR. Default: false (preview only).',
        default: false,
      },
    },
    required: ['pr_ref'],
  },
};

interface ParsedPrRef {
  number: number;
  owner: string | null;
  repo: string | null;
}

function parsePrRef(ref: string): ParsedPrRef | null {
  const trimmed = ref.trim();
  if (trimmed.length === 0) return null;
  if (PR_NUMBER_RE.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { number: n, owner: null, repo: null };
  }
  const match = trimmed.match(PR_URL_RE);
  if (!match) return null;
  const [, , owner, repo, numberStr] = match;
  if (!owner || !repo || !numberStr) return null;
  const n = Number.parseInt(numberStr, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { number: n, owner, repo };
}

export const spexReviewToolDefinition: ToolDefinition = {
  tool: TOOL,
  handle: async (rawInput, deps) => {
    const parsedInput = SpexReviewInputSchema.safeParse(rawInput);
    if (!parsedInput.success) {
      return errorResult('Invalid input for spex_review', {
        issues: parsedInput.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const input = parsedInput.data;
    const projectDir = input.project_dir ? resolve(input.project_dir) : resolve(process.cwd());

    const parsedRef = parsePrRef(input.pr_ref);
    if (!parsedRef) {
      return errorResult('Invalid pr_ref. Use a PR number or a full PR URL.', {
        pr_ref: input.pr_ref,
      });
    }

    let owner = input.owner ?? parsedRef.owner;
    let repo = input.repo ?? parsedRef.repo;
    let reviewMode = input.review_mode ?? 'single';

    try {
      const config = await loadAiConfig({ projectDir });
      const gh = config?.integrations?.github;
      if (gh) {
        if (!owner) owner = gh.owner;
        if (!repo) repo = gh.repo;
        if (!input.review_mode) reviewMode = gh.review_mode;
      }
    } catch (cause) {
      return errorResult(cause instanceof Error ? cause.message : String(cause), {
        phase: 'load-config',
      });
    }

    if (!owner || !repo) {
      return errorResult(
        'owner/repo could not be determined. Pass owner+repo, use a full PR URL, or configure integrations.github in .ai/config.yaml.',
      );
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

    let client: ReturnType<typeof createGitHubClient>;
    try {
      client = createGitHubClient();
    } catch (cause) {
      if (cause instanceof MissingGitHubTokenError) {
        return errorResult(cause.message, { envVar: 'GITHUB_TOKEN' });
      }
      throw cause;
    }

    try {
      const flow = await runReviewFlow({
        client,
        llm,
        projectDir,
        owner,
        repo,
        prNumber: parsedRef.number,
        reviewMode,
        shouldPost: () => input.auto_post,
      });
      return jsonTextResult({
        status: 'success',
        pr_number: flow.pullRequest.number,
        recommendation: flow.result.recommendation,
        overall_summary: flow.result.overall_summary,
        spec_compliance: flow.result.spec_compliance,
        conventions: flow.result.conventions,
        performance_security: flow.result.performance_security,
        test_coverage: flow.result.test_coverage,
        markdown: flow.markdown,
        feature_spec_path: flow.featureSpecPath,
        posted: flow.comment !== null,
        comment_url: flow.comment?.htmlUrl ?? null,
      });
    } catch (cause) {
      return errorResult(cause instanceof Error ? cause.message : String(cause), {
        phase: 'review-flow',
      });
    }
  },
};
