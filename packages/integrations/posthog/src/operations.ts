import { SpexError } from '@spex/core';
import { z } from 'zod';
import type {
  PostHogErrorIssue,
  PostHogErrorIssueStatus,
  PostHogErrorStackFrame,
  PostHogEvent,
  PostHogMcpClient,
  PostHogSessionRecording,
} from './types.js';

// -----------------------------------------------------------------------------
// MCP tool names
// -----------------------------------------------------------------------------
// Verified against https://posthog.com/docs/model-context-protocol — PostHog's
// MCP server uses these exact tool names. Some tools are `query-*` prefixed
// (HogQL-backed listings) while domain operations like `session-recording-get`
// are direct.

export const POSTHOG_TOOLS = {
  getErrorIssue: 'query-error-tracking-issue',
  listErrorIssues: 'query-error-tracking-issues-list',
  errorIssueEvents: 'query-error-tracking-issue-events',
  runQuery: 'query-run',
  getSessionRecording: 'session-recording-get',
  listSessionRecordings: 'query-session-recordings-list',
} as const;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export class PostHogToolError extends SpexError {
  readonly toolName: string;
  constructor(toolName: string, message: string, options?: { cause?: unknown }) {
    super(`PostHog MCP tool \`${toolName}\` failed: ${message}`, options);
    this.toolName = toolName;
  }
}

// -----------------------------------------------------------------------------
// Zod schemas (parse structuredContent from MCP responses)
// -----------------------------------------------------------------------------
// PostHog's MCP server is lenient: optional fields may be omitted, nullable
// fields may be `null` or absent, and numeric counts can arrive as numbers
// or stringified numbers. We normalise everything down to the typed domain
// shape so callers get consistent results regardless of which PostHog version
// is on the other side.

const optionalNumber = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  });

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value): string | null => (value === undefined ? null : value));

const errorIssueStatusSchema = z
  .union([
    z.literal('active'),
    z.literal('resolved'),
    z.literal('suppressed'),
    z.literal('archived'),
  ])
  .default('active') satisfies z.ZodType<PostHogErrorIssueStatus, z.ZodTypeDef, unknown>;

const stackFrameSchema = z
  .object({
    file: optionalString.default(null),
    function: optionalString.default(null),
    line: optionalNumber.default(null),
    column: optionalNumber.default(null),
    source: optionalString.default(null),
  })
  .passthrough()
  .transform(
    (raw): PostHogErrorStackFrame => ({
      file: raw.file,
      function: raw.function,
      line: raw.line,
      column: raw.column,
      source: raw.source,
    }),
  );

const stackArraySchema = z
  .union([
    z.array(stackFrameSchema),
    z.null(),
    z.undefined(),
    // Some PostHog responses bundle the stack inside `{frames: [...]}`.
    z
      .object({ frames: z.array(stackFrameSchema) })
      .transform((v) => v.frames),
  ])
  .transform((value): PostHogErrorStackFrame[] => {
    if (value === null || value === undefined) return [];
    return value;
  });

const errorIssueSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: optionalString.default(null),
    url: z.string().url(),
    status: errorIssueStatusSchema,
    firstSeen: z.string().min(1),
    lastSeen: z.string().min(1),
    occurrences: optionalNumber.default(null),
    affectedUsers: optionalNumber.default(null),
    stack: stackArraySchema.default([]),
  })
  .passthrough()
  .transform(
    (raw): PostHogErrorIssue => ({
      id: raw.id,
      name: raw.name,
      description: raw.description,
      url: raw.url,
      status: raw.status,
      firstSeen: raw.firstSeen,
      lastSeen: raw.lastSeen,
      occurrences: raw.occurrences,
      affectedUsers: raw.affectedUsers,
      stack: raw.stack,
    }),
  );

const eventPropertiesSchema = z
  .union([z.record(z.string(), z.unknown()), z.null(), z.undefined()])
  .transform((value): Record<string, unknown> => value ?? {});

const eventSchema = z
  .object({
    id: z.string().min(1),
    event: z.string().min(1),
    timestamp: z.string().min(1),
    distinctId: optionalString.default(null),
    properties: eventPropertiesSchema.default({}),
  })
  .passthrough()
  .transform(
    (raw): PostHogEvent => ({
      id: raw.id,
      event: raw.event,
      timestamp: raw.timestamp,
      distinctId: raw.distinctId,
      properties: raw.properties,
    }),
  );

const sessionRecordingSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().url(),
    startTime: z.string().min(1),
    endTime: optionalString.default(null),
    durationSeconds: optionalNumber.default(null),
    distinctId: optionalString.default(null),
    clickCount: optionalNumber.default(null),
    pageviewCount: optionalNumber.default(null),
  })
  .passthrough()
  .transform(
    (raw): PostHogSessionRecording => ({
      id: raw.id,
      url: raw.url,
      startTime: raw.startTime,
      endTime: raw.endTime,
      durationSeconds: raw.durationSeconds,
      distinctId: raw.distinctId,
      clickCount: raw.clickCount,
      pageviewCount: raw.pageviewCount,
    }),
  );

const eventListSchema = z
  .union([
    z.object({ events: z.array(eventSchema) }),
    z.object({ results: z.array(eventSchema) }).transform((v) => ({ events: v.results })),
    z.array(eventSchema).transform((events) => ({ events })),
  ])
  .transform((v) => v);

// -----------------------------------------------------------------------------
// callTool helper
// -----------------------------------------------------------------------------

interface CallToolArgs<T> {
  client: PostHogMcpClient;
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

async function callPostHogTool<T>(args: CallToolArgs<T>): Promise<T> {
  // `Client.callTool` returns the union `CallToolResult | CompatibilityCallToolResult`.
  // PostHog's MCP server returns the standard shape — narrow with a cast that
  // accepts either variant.
  const result = (await args.client.client.callTool({
    name: args.tool,
    arguments: args.arguments,
  })) as NormalizedToolResult;
  if (result.isError === true) {
    const text = extractErrorText(result);
    throw new PostHogToolError(args.tool, text);
  }
  // MCP servers return tool output via `structuredContent` when an output
  // schema is declared, and via `content[].text` otherwise. We prefer
  // structuredContent and fall back to parsing the first text content as JSON.
  const payload =
    result.structuredContent !== undefined
      ? result.structuredContent
      : extractJsonFromContent(result);
  const parsed = args.schema.safeParse(payload);
  if (!parsed.success) {
    throw new PostHogToolError(
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

function withProjectId(
  client: PostHogMcpClient,
  args: Record<string, unknown>,
): Record<string, unknown> {
  // PostHog MCP tools accept `projectId` when scoping is required. When the
  // client was constructed without an explicit project (and `POSTHOG_PROJECT_ID`
  // is unset), we omit the field entirely — PostHog falls back to the API
  // key's default project.
  if (client.projectId === undefined) return args;
  if ('projectId' in args) return args;
  return { ...args, projectId: client.projectId };
}

// -----------------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------------

export interface GetErrorIssueOptions {
  client: PostHogMcpClient;
  /** PostHog error-tracking issue ID. */
  id: string;
}

/**
 * Fetch a single PostHog error-tracking issue. Returns the issue's identity,
 * timeline, occurrence/affected-user counts, and parsed stack frames — the
 * fields SPEX's bug-fix pipeline needs when ingesting a PostHog issue as the
 * source of a bug report.
 */
export async function getErrorIssue(options: GetErrorIssueOptions): Promise<PostHogErrorIssue> {
  return callPostHogTool({
    client: options.client,
    tool: POSTHOG_TOOLS.getErrorIssue,
    arguments: withProjectId(options.client, { id: options.id }),
    schema: errorIssueSchema,
  });
}

export interface QueryEventsOptions {
  client: PostHogMcpClient;
  /**
   * HogQL / SQL query string to execute. Use the PostHog HogQL flavour
   * documented at https://posthog.com/docs/hogql. Example:
   *   `SELECT * FROM events WHERE event = '$exception' LIMIT 50`
   */
  query: string;
  /**
   * Optional row cap. When supplied the limit is forwarded to PostHog; PostHog
   * still enforces a server-side maximum (currently 10_000) regardless.
   */
  limit?: number;
}

/**
 * Run a PostHog query (HogQL) and return the events it produced. Backed by
 * the `query-run` MCP tool; the caller is responsible for query semantics.
 * The result rows are normalised to {@link PostHogEvent} shape.
 */
export async function queryEvents(options: QueryEventsOptions): Promise<PostHogEvent[]> {
  const args: Record<string, unknown> = {
    query: { kind: 'HogQLQuery', query: options.query },
  };
  if (options.limit !== undefined) args.limit = options.limit;
  const result = await callPostHogTool({
    client: options.client,
    tool: POSTHOG_TOOLS.runQuery,
    arguments: withProjectId(options.client, args),
    schema: eventListSchema,
  });
  return result.events;
}

export interface GetSessionRecordingOptions {
  client: PostHogMcpClient;
  /** PostHog session recording ID (matches `$session_id` on captured events). */
  id: string;
}

/**
 * Fetch metadata for a PostHog session recording. Returned URL is the
 * PostHog UI link, suitable for embedding in PR descriptions.
 */
export async function getSessionRecording(
  options: GetSessionRecordingOptions,
): Promise<PostHogSessionRecording> {
  return callPostHogTool({
    client: options.client,
    tool: POSTHOG_TOOLS.getSessionRecording,
    arguments: withProjectId(options.client, { id: options.id }),
    schema: sessionRecordingSchema,
  });
}
