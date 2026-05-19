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
// Live-verified against https://mcp.posthog.com/mcp via tools/list. The names
// here match the server's actual schema; an earlier draft used `query-run`,
// which does not exist — `execute-sql` is the HogQL runner.

export const POSTHOG_TOOLS = {
  getErrorIssue: 'query-error-tracking-issue',
  listErrorIssues: 'query-error-tracking-issues-list',
  errorIssueEvents: 'query-error-tracking-issue-events',
  executeSql: 'execute-sql',
  getSessionRecording: 'session-recording-get',
  listSessionRecordings: 'query-session-recordings-list',
} as const;

// PostHog requires a 15-25 word, third-person `context` string on every tool
// call (used for analytics + intent tracking). This is the SPEX default —
// callers can override per call when the bug-fix-pipeline framing doesn't fit.
// IMPORTANT: stays third-person and avoids first-person pronouns per the
// PostHog MCP requirement.
export const DEFAULT_TOOL_CONTEXT =
  'SPEX bug-fix pipeline gathers PostHog error-tracking context to draft a reproduction, root-cause analysis, and proposed code fix for the issue.';

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
    z.literal('pending_release'),
  ])
  .transform((value): PostHogErrorIssueStatus => {
    // `pending_release` is a PostHog state; treat it as still-active from the
    // bug-fix pipeline's point of view (the issue hasn't been resolved yet).
    if (value === 'pending_release') return 'active';
    return value;
  });

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

// PostHog returns issues with mixed snake_case and camelCase fields plus
// optional analytics envelopes (`_posthogUrl`, `_analytics`). The schema
// accepts whatever the server sends and normalises to our typed shape.
// Live response confirms: `id`, `name`, `description`, `first_seen`,
// `last_seen`, `status`, `_posthogUrl`, plus an `aggregations` block with
// `{occurrences, users, sessions}` and a `latestEvent` block with the top
// stack frame.

const aggregationsSchema = z
  .object({
    occurrences: optionalNumber.default(null),
    users: optionalNumber.default(null),
    sessions: optionalNumber.default(null),
  })
  .passthrough()
  .partial()
  .optional();

const latestEventStackSchema = z
  .object({
    file: optionalString.default(null),
    filename: optionalString.default(null),
    function: optionalString.default(null),
    lineno: optionalNumber.default(null),
    line: optionalNumber.default(null),
    colno: optionalNumber.default(null),
    column: optionalNumber.default(null),
    context_line: optionalString.default(null),
    source: optionalString.default(null),
  })
  .passthrough()
  .transform(
    (raw): PostHogErrorStackFrame => ({
      file: raw.filename ?? raw.file,
      function: raw.function,
      line: raw.lineno ?? raw.line,
      column: raw.colno ?? raw.column,
      source: raw.context_line ?? raw.source,
    }),
  );

const errorIssueSchema = z
  .object({
    id: z.string().min(1),
    name: optionalString.default(null),
    description: optionalString.default(null),
    // The MCP server returns the PostHog UI URL on `_posthogUrl` for issues;
    // older clients sometimes carry `url`. Accept either.
    url: optionalString.default(null),
    _posthogUrl: optionalString.default(null),
    status: errorIssueStatusSchema.optional(),
    first_seen: optionalString.default(null),
    last_seen: optionalString.default(null),
    firstSeen: optionalString.default(null),
    lastSeen: optionalString.default(null),
    aggregations: aggregationsSchema,
    // Direct counts on the issue (older / alternate shapes).
    occurrences: optionalNumber.default(null),
    users: optionalNumber.default(null),
    affectedUsers: optionalNumber.default(null),
    latestEvent: z
      .object({
        topFrame: latestEventStackSchema.optional(),
        stack: z.array(latestEventStackSchema).optional(),
      })
      .passthrough()
      .optional(),
    stack: z.array(latestEventStackSchema).optional(),
  })
  .passthrough()
  .transform((raw): PostHogErrorIssue => {
    const occurrences =
      raw.aggregations?.occurrences ?? raw.occurrences ?? null;
    const affectedUsers =
      raw.aggregations?.users ?? raw.affectedUsers ?? raw.users ?? null;
    const firstSeen = raw.first_seen ?? raw.firstSeen ?? '';
    const lastSeen = raw.last_seen ?? raw.lastSeen ?? '';
    const url = raw.url ?? raw._posthogUrl ?? '';
    let stack: PostHogErrorStackFrame[] = [];
    if (raw.latestEvent?.stack && raw.latestEvent.stack.length > 0) {
      stack = raw.latestEvent.stack;
    } else if (raw.latestEvent?.topFrame) {
      stack = [raw.latestEvent.topFrame];
    } else if (raw.stack && raw.stack.length > 0) {
      stack = raw.stack;
    }
    return {
      id: raw.id,
      name: raw.name ?? raw.id,
      description: raw.description,
      url,
      status: raw.status ?? 'active',
      firstSeen,
      lastSeen,
      occurrences,
      affectedUsers,
      stack,
    };
  });

const eventPropertiesSchema = z
  .union([z.record(z.string(), z.unknown()), z.null(), z.undefined()])
  .transform((value): Record<string, unknown> => value ?? {});

// PostHog's MCP server returns event rows with snake_case identity fields
// (`uuid`, `distinct_id`, `event`, `timestamp`) plus a properties bag.
// Some endpoints use `id` instead of `uuid`. Accept both.
const eventSchema = z
  .object({
    id: optionalString.default(null),
    uuid: optionalString.default(null),
    event: optionalString.default(null),
    timestamp: optionalString.default(null),
    distinctId: optionalString.default(null),
    distinct_id: optionalString.default(null),
    properties: eventPropertiesSchema.default({}),
  })
  .passthrough()
  .transform(
    (raw): PostHogEvent => ({
      id: raw.id ?? raw.uuid ?? '',
      event: raw.event ?? '$exception',
      timestamp: raw.timestamp ?? '',
      distinctId: raw.distinctId ?? raw.distinct_id,
      properties: raw.properties,
    }),
  );

// PostHog's session-recording-get response uses snake_case
// (`start_time`, `end_time`, `recording_duration`, `distinct_id`,
// `click_count`, `_posthogUrl`). The schema accepts both shapes so unit
// tests built against camelCase fixtures still pass.
const sessionRecordingSchema = z
  .object({
    id: z.string().min(1),
    url: optionalString.default(null),
    _posthogUrl: optionalString.default(null),
    startTime: optionalString.default(null),
    start_time: optionalString.default(null),
    endTime: optionalString.default(null),
    end_time: optionalString.default(null),
    durationSeconds: optionalNumber.default(null),
    recording_duration: optionalNumber.default(null),
    distinctId: optionalString.default(null),
    distinct_id: optionalString.default(null),
    clickCount: optionalNumber.default(null),
    click_count: optionalNumber.default(null),
    pageviewCount: optionalNumber.default(null),
    pageview_count: optionalNumber.default(null),
  })
  .passthrough()
  .transform(
    (raw): PostHogSessionRecording => ({
      id: raw.id,
      url: raw.url ?? raw._posthogUrl ?? '',
      startTime: raw.startTime ?? raw.start_time ?? '',
      endTime: raw.endTime ?? raw.end_time,
      durationSeconds: raw.durationSeconds ?? raw.recording_duration,
      distinctId: raw.distinctId ?? raw.distinct_id,
      clickCount: raw.clickCount ?? raw.click_count,
      pageviewCount: raw.pageviewCount ?? raw.pageview_count,
    }),
  );

// `query-error-tracking-issue-events` returns `{events: [...], totalCount}`
// in newer responses and `{results: [...]}` in older ones. Accept either.
const issueEventListSchema = z
  .union([
    z.object({ events: z.array(eventSchema) }).passthrough(),
    z
      .object({ results: z.array(eventSchema) })
      .passthrough()
      .transform((v) => ({ events: v.results })),
    z.array(eventSchema).transform((events) => ({ events })),
  ])
  .transform((v) => v);

// `execute-sql` returns tabular `{columns: string[], results: unknown[][]}`.
// We synthesise PostHogEvent rows when the column set looks event-shaped
// (must contain at least `event` and `timestamp`); otherwise we project
// minimally so callers still get something to inspect.
const sqlTabularSchema = z
  .object({
    columns: z.array(z.string()),
    results: z.array(z.array(z.unknown())),
  })
  .passthrough();

const sqlResultSchema = z
  .union([
    // Newer shape: `{events: [...]}` — produced when execute-sql is queried
    // through certain wrappers; treat the same as issue-events.
    z.object({ events: z.array(eventSchema) }).passthrough(),
    sqlTabularSchema,
    z.array(eventSchema).transform((events) => ({ columns: [], results: [], events })),
  ])
  .transform((value): { events: PostHogEvent[] } => {
    if ('events' in value && Array.isArray(value.events)) {
      return { events: value.events as PostHogEvent[] };
    }
    const columns = (value as { columns?: unknown }).columns;
    const results = (value as { results?: unknown }).results;
    if (!Array.isArray(columns) || !Array.isArray(results)) {
      return { events: [] };
    }
    const events: PostHogEvent[] = [];
    for (const row of results) {
      if (!Array.isArray(row)) continue;
      const record: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i += 1) {
        const key = columns[i];
        if (typeof key === 'string') record[key] = row[i];
      }
      const parsed = eventSchema.safeParse(record);
      if (parsed.success) {
        events.push(parsed.data);
      }
    }
    return { events };
  });

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
          // Not JSON. Try PostHog's SQL text-table format — `execute-sql`
          // returns rows wrapped in a fenced code block (`column1|column2`
          // header + pipe-separated rows). Falling back keeps queryEvents
          // working against the real server.
          const table = parsePostHogSqlTextTable(text);
          if (table !== null) return table;
        }
      }
    }
  }
  return null;
}

/**
 * Parse the SQL text-table format PostHog's `execute-sql` MCP tool returns:
 *
 *   Here is the results table of the HogQLQuery insight:
 *
 *   ```
 *   col_a|col_b
 *   val_1|val_2
 *   ```
 *
 *   <system_reminder>…</system_reminder>
 *
 * Returns `{columns, results}` (rows as `unknown[][]` — cells are strings)
 * or `null` when the text doesn't match. PostHog's pipe-separated format
 * collides with literal pipes in values, but those are rare in the columns
 * SPEX cares about (uuid / event / timestamp / distinct_id / properties).
 */
function parsePostHogSqlTextTable(text: string): { columns: string[]; results: unknown[][] } | null {
  const fenceMatch = text.match(/```\s*\n([\s\S]+?)\n```/);
  const body = fenceMatch?.[1] ?? text;
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const header = lines[0];
  if (header === undefined || !header.includes('|')) return null;
  const columns = header.split('|').map((c) => c.trim());
  const results: unknown[][] = [];
  for (const line of lines.slice(1)) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // Try to parse each cell as JSON so nested objects (like `properties`)
    // come back typed. Non-JSON cells (timestamps, plain strings) stay as
    // strings.
    const typed = cells.map((c) => {
      try {
        return JSON.parse(c);
      } catch {
        return c;
      }
    });
    results.push(typed);
  }
  if (results.length === 0) {
    // Header-only response (count() returning a single number with no rows
    // isn't valid here — only emit a result when we actually parsed rows).
    return null;
  }
  return { columns, results };
}

// Note: PostHog's MCP server scopes calls to the project tied to the API
// key (via the personal API key + Project ID set in PostHog's OAuth/API
// settings). Per-tool `projectId` arguments are not part of the live schema
// — the earlier wrapper that injected them has been removed.

// -----------------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------------

export interface GetErrorIssueOptions {
  client: PostHogMcpClient;
  /** PostHog error-tracking issue ID. */
  id: string;
  /**
   * PostHog MCP tools require a 15-25 word, third-person analytics context
   * string. Defaults to {@link DEFAULT_TOOL_CONTEXT}; override when the
   * call's purpose differs from the default bug-fix-pipeline framing.
   */
  context?: string;
  /**
   * Time window for occurrence + impact counts. PostHog defaults to `-7d`
   * if omitted; for older issues SPEX widens this.
   */
  dateFrom?: string;
}

/**
 * Fetch a single PostHog error-tracking issue. Returns the issue's identity,
 * timeline, occurrence/affected-user counts, and parsed stack frames — the
 * fields SPEX's bug-fix pipeline needs when ingesting a PostHog issue as the
 * source of a bug report.
 */
export async function getErrorIssue(options: GetErrorIssueOptions): Promise<PostHogErrorIssue> {
  const args: Record<string, unknown> = {
    issueId: options.id,
    context: options.context ?? DEFAULT_TOOL_CONTEXT,
  };
  if (options.dateFrom !== undefined) {
    args.dateRange = { date_from: options.dateFrom };
  }
  return callPostHogTool({
    client: options.client,
    tool: POSTHOG_TOOLS.getErrorIssue,
    arguments: args,
    schema: errorIssueSchema,
  });
}

export interface QueryEventsOptions {
  client: PostHogMcpClient;
  /**
   * HogQL query string. PostHog's `execute-sql` tool accepts the SQL
   * directly (no wrapping envelope). Always include a time-range predicate
   * on `events.timestamp` — PostHog rejects unbounded scans.
   */
  query: string;
  /**
   * PostHog MCP tools require a 15-25 word, third-person analytics context
   * string. Defaults to {@link DEFAULT_TOOL_CONTEXT}.
   */
  context?: string;
  /**
   * When false, PostHog returns untruncated JSON blobs in result rows.
   * Defaults to true.
   */
  truncate?: boolean;
}

/**
 * Run a HogQL query via PostHog's `execute-sql` MCP tool and project the
 * returned rows to {@link PostHogEvent} shape (best-effort — PostHog's
 * tabular result format flattens to `{columns, results}` so we synthesise
 * the typed columns when present).
 */
export async function queryEvents(options: QueryEventsOptions): Promise<PostHogEvent[]> {
  const args: Record<string, unknown> = {
    query: options.query,
    context: options.context ?? DEFAULT_TOOL_CONTEXT,
  };
  if (options.truncate !== undefined) args.truncate = options.truncate;
  const result = await callPostHogTool({
    client: options.client,
    tool: POSTHOG_TOOLS.executeSql,
    arguments: args,
    schema: sqlResultSchema,
  });
  return result.events;
}

export interface GetIssueEventsOptions {
  client: PostHogMcpClient;
  /** Error-tracking issue UUID. */
  issueId: string;
  /** Row cap (PostHog default 1, max 20). */
  limit?: number;
  /** `summary` | `stack` | `raw`. SPEX defaults to `stack` to get frame data. */
  verbosity?: 'summary' | 'stack' | 'raw';
  /** Time window. Defaults to PostHog's `-7d`. */
  dateFrom?: string;
  /** PostHog MCP analytics context. Defaults to {@link DEFAULT_TOOL_CONTEXT}. */
  context?: string;
}

/**
 * Fetch sampled `$exception` events for one issue via the purpose-built
 * `query-error-tracking-issue-events` MCP tool. Preferred over `queryEvents`
 * for issue-scoped lookups (no HogQL needed; PostHog filters server-side).
 */
export async function getIssueEvents(options: GetIssueEventsOptions): Promise<PostHogEvent[]> {
  const args: Record<string, unknown> = {
    issueId: options.issueId,
    verbosity: options.verbosity ?? 'stack',
    limit: options.limit ?? 5,
    context: options.context ?? DEFAULT_TOOL_CONTEXT,
  };
  if (options.dateFrom !== undefined) {
    args.dateRange = { date_from: options.dateFrom };
  }
  const result = await callPostHogTool({
    client: options.client,
    tool: POSTHOG_TOOLS.errorIssueEvents,
    arguments: args,
    schema: issueEventListSchema,
  });
  return result.events;
}

export interface GetSessionRecordingOptions {
  client: PostHogMcpClient;
  /** PostHog session recording ID (matches `$session_id` on captured events). */
  id: string;
  /** PostHog MCP analytics context. Defaults to {@link DEFAULT_TOOL_CONTEXT}. */
  context?: string;
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
    arguments: { id: options.id, context: options.context ?? DEFAULT_TOOL_CONTEXT },
    schema: sessionRecordingSchema,
  });
}
