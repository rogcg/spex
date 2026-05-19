import { SpexError } from '@spex/core';
import { z } from 'zod';
import type {
  LinearComment,
  LinearIssue,
  LinearLabel,
  LinearMcpClient,
  LinearTeam,
  LinearUser,
  LinearWorkflowStateType,
} from './types.js';

// -----------------------------------------------------------------------------
// MCP tool names
// -----------------------------------------------------------------------------
// The official Linear MCP server advertises these tool names. They live here
// rather than at each call site so an upstream rename only touches one spot.

export const LINEAR_TOOLS = {
  getIssue: 'get_issue',
  listIssues: 'list_issues',
  createIssue: 'create_issue',
  updateIssue: 'update_issue',
  createComment: 'create_comment',
} as const;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export class LinearToolError extends SpexError {
  readonly toolName: string;
  constructor(toolName: string, message: string, options?: { cause?: unknown }) {
    super(`Linear MCP tool \`${toolName}\` failed: ${message}`, options);
    this.toolName = toolName;
  }
}

// -----------------------------------------------------------------------------
// Zod schemas (parse structuredContent from MCP responses)
// -----------------------------------------------------------------------------

// Schemas use `.nullable()` (not `.default(null)`) so the parsed output type
// stays `T | null` rather than `T | null | undefined` — required for the
// repo's `exactOptionalPropertyTypes: true` setting. Each operation
// explicitly returns the domain type, so a schema/type drift surfaces at
// compile time.

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  email: z.string().email().nullable(),
}) satisfies z.ZodType<LinearUser>;

const labelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
}) satisfies z.ZodType<LinearLabel>;

const teamSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
}) satisfies z.ZodType<LinearTeam>;

const workflowStateTypeSchema = z.enum([
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
]) satisfies z.ZodType<LinearWorkflowStateType>;

const issueStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: workflowStateTypeSchema,
});

const issueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string().url(),
  status: issueStatusSchema,
  team: teamSchema,
  assignee: userSchema.nullable(),
  labels: z.array(labelSchema),
  priority: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<LinearIssue>;

const commentSchema = z.object({
  id: z.string(),
  body: z.string(),
  url: z.string().url(),
  createdAt: z.string(),
  user: userSchema.nullable(),
}) satisfies z.ZodType<LinearComment>;

const listIssuesSchema = z.object({
  issues: z.array(issueSchema),
});

// -----------------------------------------------------------------------------
// callTool helper
// -----------------------------------------------------------------------------

interface CallToolArgs<T> {
  client: LinearMcpClient;
  tool: string;
  arguments: Record<string, unknown>;
  schema: z.ZodType<T>;
}

interface NormalizedToolResult {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}

async function callLinearTool<T>(args: CallToolArgs<T>): Promise<T> {
  // `Client.callTool` returns the union `CallToolResult | CompatibilityCallToolResult`.
  // Linear's MCP server returns the standard shape — narrow with a cast that
  // accepts either variant.
  const result = (await args.client.client.callTool({
    name: args.tool,
    arguments: args.arguments,
  })) as NormalizedToolResult;
  if (result.isError === true) {
    const text = extractErrorText(result);
    throw new LinearToolError(args.tool, text);
  }
  // MCP servers return tool output via `structuredContent` when an output
  // schema is declared, and via `content[].text` otherwise. We prefer
  // structuredContent — Linear's MCP server advertises output schemas — but
  // fall back to parsing the first text content as JSON for resilience.
  const payload =
    result.structuredContent !== undefined
      ? result.structuredContent
      : extractJsonFromContent(result);
  const parsed = args.schema.safeParse(payload);
  if (!parsed.success) {
    throw new LinearToolError(
      args.tool,
      `response did not match expected schema: ${parsed.error.message}`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function extractErrorText(result: NormalizedToolResult): string {
  const content = result.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        'type' in part &&
        (part as { type: unknown }).type === 'text'
      ) {
        const text = (part as { text?: unknown }).text;
        if (typeof text === 'string' && text.length > 0) return text;
      }
    }
  }
  return 'unknown error (no text content returned)';
}

function extractJsonFromContent(result: NormalizedToolResult): unknown {
  const content = result.content;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (
      part &&
      typeof part === 'object' &&
      'type' in part &&
      (part as { type: unknown }).type === 'text'
    ) {
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string' && text.length > 0) {
        try {
          return JSON.parse(text);
        } catch {
          // fall through to next part
        }
      }
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------------

export interface GetLinearIssueOptions {
  client: LinearMcpClient;
  /** Issue ID (UUID) or human identifier (e.g. `SPX-47`). */
  id: string;
}

export async function getLinearIssue(options: GetLinearIssueOptions): Promise<LinearIssue> {
  return callLinearTool({
    client: options.client,
    tool: LINEAR_TOOLS.getIssue,
    arguments: { id: options.id },
    schema: issueSchema,
  });
}

export interface UpdateLinearIssueStatusOptions {
  client: LinearMcpClient;
  id: string;
  /**
   * Target workflow state. Accepts either a state ID, the state name (e.g.
   * `In Review`), or the state type (e.g. `started`). The Linear MCP server
   * resolves the value against the issue's team workflow.
   */
  status: string;
}

export async function updateLinearIssueStatus(
  options: UpdateLinearIssueStatusOptions,
): Promise<LinearIssue> {
  return callLinearTool({
    client: options.client,
    tool: LINEAR_TOOLS.updateIssue,
    arguments: { id: options.id, state: options.status },
    schema: issueSchema,
  });
}

export interface CreateLinearIssueOptions {
  client: LinearMcpClient;
  /** Team ID, key (e.g. `SPX`), or name. */
  team: string;
  title: string;
  description?: string;
  /** Label IDs or names. */
  labels?: readonly string[];
}

export async function createLinearIssue(options: CreateLinearIssueOptions): Promise<LinearIssue> {
  const args: Record<string, unknown> = {
    team: options.team,
    title: options.title,
  };
  if (options.description !== undefined) args.description = options.description;
  if (options.labels !== undefined && options.labels.length > 0) {
    args.labels = [...options.labels];
  }
  return callLinearTool({
    client: options.client,
    tool: LINEAR_TOOLS.createIssue,
    arguments: args,
    schema: issueSchema,
  });
}

export interface AddLinearCommentOptions {
  client: LinearMcpClient;
  /** Issue ID (UUID) or human identifier (e.g. `SPX-47`). */
  issueId: string;
  body: string;
}

export async function addLinearComment(options: AddLinearCommentOptions): Promise<LinearComment> {
  return callLinearTool({
    client: options.client,
    tool: LINEAR_TOOLS.createComment,
    arguments: { issueId: options.issueId, body: options.body },
    schema: commentSchema,
  });
}

export interface ListLinearIssuesOptions {
  client: LinearMcpClient;
  /** Team ID, key, or name. */
  team: string;
  /** Workflow state names or types to filter by. */
  states?: readonly string[];
  /** Label names to filter by. */
  labels?: readonly string[];
  /** Assignee user ID, "me", or email. */
  assignee?: string;
  /** Max results. Defaults to whatever the Linear MCP server defaults to. */
  limit?: number;
}

export async function listLinearIssues(options: ListLinearIssuesOptions): Promise<LinearIssue[]> {
  const args: Record<string, unknown> = { team: options.team };
  if (options.states !== undefined && options.states.length > 0) args.states = [...options.states];
  if (options.labels !== undefined && options.labels.length > 0) args.labels = [...options.labels];
  if (options.assignee !== undefined) args.assignee = options.assignee;
  if (options.limit !== undefined) args.limit = options.limit;
  const result = await callLinearTool({
    client: options.client,
    tool: LINEAR_TOOLS.listIssues,
    arguments: args,
    schema: listIssuesSchema,
  });
  return result.issues;
}
