import { SpexError } from '@spex/core';
import { z } from 'zod';
import type {
  LinearComment,
  LinearIssue,
  LinearMcpClient,
  LinearWorkflowStateType,
} from './types.js';

// -----------------------------------------------------------------------------
// MCP tool names
// -----------------------------------------------------------------------------
// Verified against https://mcp.linear.app/mcp via tools/list. The server uses
// a single `save_issue` / `save_comment` endpoint for both create and update
// (presence of `id` toggles the mode), so `createIssue` and `updateIssue`
// alias the same tool.

export const LINEAR_TOOLS = {
  getIssue: 'get_issue',
  listIssues: 'list_issues',
  createIssue: 'save_issue',
  updateIssue: 'save_issue',
  createComment: 'save_comment',
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

// Schemas mirror what Linear's MCP server actually returns. The server is
// lenient about which fields it includes, so we use `.passthrough()` and
// preprocess scalar/object unions (e.g. `priority` arrives as either a number
// or `{value, name}`) into the simple primitives our domain types expose.

const workflowStateTypeSchema = z.enum([
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
]) satisfies z.ZodType<LinearWorkflowStateType>;

const labelArraySchema = z
  .array(z.union([z.string(), z.object({ name: z.string() }).passthrough()]))
  .transform((items) => items.map((item) => (typeof item === 'string' ? item : item.name)))
  .default([]);

const priorityFieldSchema = z
  .union([z.number(), z.object({ value: z.number() }).passthrough(), z.null()])
  .transform((value) => {
    if (value === null) return null;
    if (typeof value === 'number') return value;
    return value.value;
  })
  .nullable();

const issueSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable().default(null),
    url: z.string().url(),
    status: z.string(),
    statusType: workflowStateTypeSchema,
    team: z.string(),
    teamId: z.string(),
    project: z.string().nullable().default(null),
    projectId: z.string().nullable().default(null),
    priority: priorityFieldSchema.default(null),
    labels: labelArraySchema,
    gitBranchName: z.string().nullable().default(null),
    createdAt: z.string(),
    updatedAt: z.string(),
    startedAt: z.string().nullable().default(null),
    completedAt: z.string().nullable().default(null),
    canceledAt: z.string().nullable().default(null),
    archivedAt: z.string().nullable().default(null),
    dueDate: z.string().nullable().default(null),
  })
  .passthrough()
  .transform(
    (raw): LinearIssue => ({
      identifier: raw.id,
      title: raw.title,
      description: raw.description,
      url: raw.url,
      status: raw.status,
      statusType: raw.statusType,
      team: raw.team,
      teamId: raw.teamId,
      project: raw.project,
      projectId: raw.projectId,
      priority: raw.priority,
      labels: raw.labels,
      gitBranchName: raw.gitBranchName,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      startedAt: raw.startedAt,
      completedAt: raw.completedAt,
      canceledAt: raw.canceledAt,
      archivedAt: raw.archivedAt,
      dueDate: raw.dueDate,
    }),
  );

const commentUserSchema = z
  .union([z.string(), z.object({ name: z.string() }).passthrough(), z.null()])
  .transform((v) => {
    if (v === null) return null;
    return typeof v === 'string' ? v : v.name;
  });

const commentSchema = z
  .object({
    id: z.string(),
    body: z.string(),
    // Linear's save_comment response does not always include `url`; treat as
    // optional and synthesise an empty string when missing. Callers should
    // treat empty-string urls as "no permalink available".
    url: z.string().optional().default(''),
    createdAt: z.string(),
    user: commentUserSchema.optional().default(null),
    userId: z.string().nullable().optional().default(null),
  })
  .passthrough()
  .transform(
    (raw): LinearComment => ({
      id: raw.id,
      body: raw.body,
      url: raw.url,
      createdAt: raw.createdAt,
      user: raw.user,
      userId: raw.userId,
    }),
  );

const listIssuesSchema = z
  .union([
    z.object({ issues: z.array(issueSchema) }),
    z.array(issueSchema).transform((issues) => ({ issues })),
  ])
  .transform((v) => v);

// -----------------------------------------------------------------------------
// callTool helper
// -----------------------------------------------------------------------------

interface CallToolArgs<T> {
  client: LinearMcpClient;
  tool: string;
  arguments: Record<string, unknown>;
  // Use the 3-type form so transform-producing schemas (input != output) fit.
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
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
