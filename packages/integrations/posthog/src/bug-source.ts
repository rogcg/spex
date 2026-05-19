import { getErrorIssue, queryEvents } from './operations.js';
import type {
  PostHogErrorIssue,
  PostHogErrorStackFrame,
  PostHogEvent,
  PostHogMcpClient,
} from './types.js';

/**
 * The bug-context bundle the SPEX `fix` pipeline consumes when the bug
 * report is sourced from a PostHog error-tracking issue. All fields except
 * `issue` are derived and may be empty when PostHog hasn't surfaced them
 * (e.g. an issue with no session recordings, or one with no exception
 * properties on its events).
 */
export interface PostHogBugSource {
  /** The raw PostHog issue, kept for callers that want to render it directly. */
  issue: PostHogErrorIssue;
  /**
   * Plain-text description suitable for passing as `spex fix`'s `description`.
   * Includes the issue title, headline message, occurrence/user counts,
   * timeline, and the symbolicated stack as text. Stable enough for the LLM
   * hypothesis generator to read.
   */
  description: string;
  /** Top-of-stack exception message, when available. */
  errorMessage: string | undefined;
  /** Symbolicated stack rendered as text, when available. */
  errorStack: string | undefined;
  /** First-occurrence timestamp from the issue (ISO-8601). */
  firstOccurrence: string;
  /**
   * PostHog session recording URLs linked to recent events for this issue.
   * Empty when PostHog has no recordings for the issue. Capped to keep PR
   * descriptions readable.
   */
  sessionRecordingUrls: readonly string[];
}

export interface BuildPostHogBugSourceOptions {
  client: PostHogMcpClient;
  /** PostHog error-tracking issue ID. */
  issueId: string;
  /**
   * Maximum session recording links to surface. Defaults to 3 — PostHog can
   * return dozens for a busy issue, but the PR description only needs a few
   * to be useful.
   */
  maxSessionRecordings?: number;
  /**
   * Override the events-query lookback. Defaults to events ingested in the
   * last 7 days. Set this when an issue's first-seen is older than the
   * default window and you still need its recordings.
   */
  recentEventsWindowDays?: number;
}

const DEFAULT_MAX_RECORDINGS = 3;
const DEFAULT_LOOKBACK_DAYS = 7;
// PostHog stores the matching URL on `$session_id` (for the recording id) and
// on `$current_url` (for the page when the error fired). We surface whatever
// is present, preferring a PostHog Replay deep-link when we can construct one.
const SESSION_ID_PROPS = ['$session_id', 'sessionId'] as const;

/**
 * Fetch a PostHog error issue and the small surrounding context SPEX needs to
 * run a `fix` pipeline against it: a clean description, the error message
 * and stack, and any session recording URLs PostHog has for the issue's
 * recent events.
 *
 * One PostHog round-trip is unavoidable (the issue itself). A second
 * round-trip queries `$exception` events tagged with the issue id to gather
 * session recordings — it's skipped entirely when `maxSessionRecordings` is
 * zero, so callers that don't care about replays can avoid the extra call.
 */
export async function buildPostHogBugSource(
  options: BuildPostHogBugSourceOptions,
): Promise<PostHogBugSource> {
  const issue = await getErrorIssue({ client: options.client, id: options.issueId });

  const maxRecordings = options.maxSessionRecordings ?? DEFAULT_MAX_RECORDINGS;
  let sessionRecordingUrls: readonly string[] = [];
  if (maxRecordings > 0) {
    sessionRecordingUrls = await collectSessionRecordingUrls({
      client: options.client,
      issueId: options.issueId,
      maxRecordings,
      lookbackDays: options.recentEventsWindowDays ?? DEFAULT_LOOKBACK_DAYS,
    });
  }

  const errorStack = issue.stack.length > 0 ? formatStack(issue.stack) : undefined;
  const errorMessage = extractTopFrameMessage(issue) ?? issue.name;

  return {
    issue,
    description: buildDescription(issue, sessionRecordingUrls),
    errorMessage,
    errorStack,
    firstOccurrence: issue.firstSeen,
    sessionRecordingUrls,
  };
}

function buildDescription(
  issue: PostHogErrorIssue,
  sessionRecordingUrls: readonly string[],
): string {
  const lines: string[] = [];
  lines.push(`PostHog issue: ${issue.name}`);
  lines.push('');
  if (issue.description !== null && issue.description.trim().length > 0) {
    lines.push(issue.description.trim());
    lines.push('');
  }
  const counts: string[] = [];
  if (issue.occurrences !== null) counts.push(`occurrences=${issue.occurrences}`);
  if (issue.affectedUsers !== null) counts.push(`affectedUsers=${issue.affectedUsers}`);
  counts.push(`firstSeen=${issue.firstSeen}`);
  counts.push(`lastSeen=${issue.lastSeen}`);
  counts.push(`status=${issue.status}`);
  lines.push(`Telemetry: ${counts.join(', ')}`);
  lines.push(`PostHog link: ${issue.url}`);

  if (issue.stack.length > 0) {
    lines.push('');
    lines.push('Stack:');
    lines.push(formatStack(issue.stack));
  }

  if (sessionRecordingUrls.length > 0) {
    lines.push('');
    lines.push('Session recordings:');
    for (const url of sessionRecordingUrls) {
      lines.push(`- ${url}`);
    }
  }
  return lines.join('\n');
}

function formatStack(stack: readonly PostHogErrorStackFrame[]): string {
  return stack.map(formatStackFrame).join('\n');
}

function formatStackFrame(frame: PostHogErrorStackFrame): string {
  const location =
    frame.file !== null
      ? `${frame.file}${frame.line !== null ? `:${frame.line}` : ''}${
          frame.column !== null ? `:${frame.column}` : ''
        }`
      : '<unknown location>';
  const fn = frame.function !== null ? frame.function : '<anonymous>';
  const head = `  at ${fn} (${location})`;
  if (frame.source === null || frame.source.length === 0) return head;
  return `${head}\n      | ${frame.source}`;
}

function extractTopFrameMessage(issue: PostHogErrorIssue): string | undefined {
  // The issue's `name` field is typically "ExceptionType: message". When
  // PostHog instead splits message/type into separate properties, we'd need
  // event-level access — out of scope here, so fall back to `name`.
  if (issue.name.length === 0) return undefined;
  return issue.name;
}

interface CollectRecordingsArgs {
  client: PostHogMcpClient;
  issueId: string;
  maxRecordings: number;
  lookbackDays: number;
}

async function collectSessionRecordingUrls(
  args: CollectRecordingsArgs,
): Promise<readonly string[]> {
  // HogQL: pull recent $exception events tagged with this issue. PostHog
  // exposes the issue id as `properties.$exception_issue_id` (see
  // https://posthog.com/docs/error-tracking).
  const query = [
    'SELECT *',
    'FROM events',
    "WHERE event = '$exception'",
    `  AND properties.\`$exception_issue_id\` = '${escapeSingleQuotes(args.issueId)}'`,
    `  AND timestamp > now() - INTERVAL ${args.lookbackDays} DAY`,
    'ORDER BY timestamp DESC',
    `LIMIT ${args.maxRecordings * 4}`,
  ].join('\n');

  let events: PostHogEvent[];
  try {
    events = await queryEvents({
      client: args.client,
      query,
      limit: args.maxRecordings * 4,
    });
  } catch {
    // PostHog rejected the query (most often because the project hasn't
    // ingested $exception events). Return no recordings rather than failing
    // the whole bug-source build — the description is still useful.
    return [];
  }

  const urls = new Set<string>();
  for (const event of events) {
    const url = sessionRecordingUrl(event, args.client);
    if (url !== null) {
      urls.add(url);
      if (urls.size >= args.maxRecordings) break;
    }
  }
  return Array.from(urls);
}

function sessionRecordingUrl(event: PostHogEvent, client: PostHogMcpClient): string | null {
  const sessionId = extractSessionId(event.properties);
  if (sessionId === null) return null;
  // Prefer the explicitly tagged URL when PostHog provides one.
  const explicit = event.properties.$session_recording_url;
  if (typeof explicit === 'string' && explicit.startsWith('http')) return explicit;
  // Otherwise synthesize the standard PostHog Replay URL.
  const projectId = client.projectId;
  if (projectId === undefined) return null;
  return `https://app.posthog.com/project/${projectId}/replay/${sessionId}`;
}

function extractSessionId(props: Record<string, unknown>): string | null {
  for (const key of SESSION_ID_PROPS) {
    const value = props[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function escapeSingleQuotes(value: string): string {
  // HogQL uses backslash-escaped single quotes inside string literals.
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
