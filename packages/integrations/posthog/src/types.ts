import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export interface CreatePostHogMcpClientOptions {
  /**
   * PostHog personal API key. Defaults to `process.env.POSTHOG_API_KEY`.
   * Generate at https://posthog.com/project/<id>/settings/user-api-keys with
   * the "MCP Server" preset. Throws {@link MissingPostHogApiKeyError} when
   * both are absent or empty.
   */
  apiKey?: string;
  /**
   * PostHog project ID the client should scope its calls to. Defaults to
   * `process.env.POSTHOG_PROJECT_ID`. Forwarded to MCP tool calls as
   * `projectId` when the operation accepts it. May be `undefined` — the
   * PostHog MCP server falls back to the API key's default project.
   */
  projectId?: string;
  /**
   * PostHog MCP endpoint URL. Defaults to `https://mcp.posthog.com/mcp` (the
   * official Streamable HTTP endpoint, which auto-routes to the correct data
   * region based on the account behind the API key). Must be HTTPS unless
   * pointing at `localhost` / `127.0.0.1` — see
   * {@link InsecurePostHogEndpointError}.
   */
  baseUrl?: string;
  /**
   * Client implementation name advertised during the MCP handshake. Defaults
   * to `spex`.
   */
  clientName?: string;
  /**
   * Client implementation version advertised during the MCP handshake.
   * Defaults to the current `@spex/integrations-posthog` version.
   */
  clientVersion?: string;
  /**
   * Override the transport directly. When provided, `baseUrl`, HTTPS
   * enforcement, and pooling are all bypassed — the caller fully owns the
   * transport's lifecycle. Intended for one-off custom connections; not used
   * by the standard call path.
   */
  transport?: Transport;
  /**
   * Custom factory for the transport produced by the pooled (apiKey-driven)
   * path. When omitted, the default factory builds a
   * `StreamableHTTPClientTransport` with `Authorization: Bearer <apiKey>`.
   * Pooling still applies — the factory is only invoked on a pool miss.
   *
   * Two real uses:
   *   1. Tests pair this with an `InMemoryTransport` + stub server to
   *      exercise the pool without touching the network.
   *   2. Production deployments behind custom proxies / instrumentation that
   *      need a non-default transport.
   */
  transportFactory?: TransportFactory;
  /**
   * Custom fetch implementation passed through to the default transport.
   * Defaults to the global `fetch`. Ignored when `transportFactory` is
   * supplied (the factory controls its own networking).
   */
  fetchImpl?: typeof fetch;
}

/**
 * Arguments passed to a {@link CreatePostHogMcpClientOptions.transportFactory}.
 * Never includes the raw API key — only the resolved URL and the headers the
 * default factory would have set.
 */
export interface TransportFactoryArgs {
  url: URL;
  headers: Record<string, string>;
}

export type TransportFactory = (args: TransportFactoryArgs) => Transport;

export interface PostHogMcpClient {
  /**
   * Underlying MCP SDK client. Use `client.callTool(...)`, `client.listTools()`,
   * etc. to talk to PostHog's MCP server.
   */
  readonly client: Client;
  /**
   * Resolved endpoint URL the transport is connected to. `null` when a custom
   * `transport` was injected (no URL is meaningful in that case).
   */
  readonly endpoint: string | null;
  /**
   * Default PostHog project ID forwarded to operations that accept one. May be
   * `undefined`, in which case the PostHog MCP server uses the API key's
   * default project.
   */
  readonly projectId: string | undefined;
  /**
   * Tear down this pooled connection. Subsequent calls to
   * `createPostHogMcpClient(...)` with the same `(baseUrl, apiKey)` will open
   * a fresh connection.
   */
  close(): Promise<void>;
}

/**
 * The shape used internally to key the connection pool. Exposed for tests
 * that need to assert pool behaviour. The raw API key is never stored on this
 * object — only a SHA-256 fingerprint prefix.
 */
export interface PostHogMcpClientCacheKey {
  baseUrl: string;
  apiKeyFingerprint: string;
}

// -----------------------------------------------------------------------------
// PostHog domain types
// -----------------------------------------------------------------------------
// Mirror the JSON returned by https://mcp.posthog.com/mcp. PostHog's MCP
// server returns rich payloads — we project them down to the fields SPEX
// actually consumes from a bug-fix context (the stack trace, occurrence
// counts, affected user counts, and a link back to the PostHog UI). Callers
// that need richer data can still reach into the underlying `client` and
// call tools directly.

export interface PostHogErrorIssue {
  /** PostHog-assigned UUID for the issue. */
  id: string;
  /** Short human title (typically `<ExceptionType>: <message>` for code errors). */
  name: string;
  /** Multi-line message — usually the exception message and a context paragraph. */
  description: string | null;
  /** PostHog UI URL for this issue (used in PR descriptions to deep-link). */
  url: string;
  /** Workflow state — `active`, `resolved`, `suppressed`, `archived`. */
  status: PostHogErrorIssueStatus;
  /** First time PostHog saw a fingerprinted event for this issue (ISO-8601). */
  firstSeen: string;
  /** Most recent occurrence (ISO-8601). */
  lastSeen: string;
  /** Total events ever recorded for this issue. May be `null` for fresh issues. */
  occurrences: number | null;
  /** Distinct affected users. May be `null` when PostHog has not yet computed it. */
  affectedUsers: number | null;
  /** Full exception stack frames, top-of-stack first. Empty when unavailable. */
  stack: PostHogErrorStackFrame[];
}

export type PostHogErrorIssueStatus = 'active' | 'resolved' | 'suppressed' | 'archived';

export interface PostHogErrorStackFrame {
  /** Source path/URL of the frame. */
  file: string | null;
  /** Function / method name when symbolicated. */
  function: string | null;
  /** Line number, 1-based when available. */
  line: number | null;
  /** Column number, 1-based when available. */
  column: number | null;
  /** Source snippet around the frame, when PostHog has it. */
  source: string | null;
}

/**
 * A single PostHog event. Captured from a SQL/HogQL query result row. PostHog
 * events are wide and largely user-defined, so we expose a small typed surface
 * (the universal columns) plus a `properties` bag for everything else.
 */
export interface PostHogEvent {
  /** PostHog event UUID. */
  id: string;
  /** Event name (e.g. `$exception`, `$pageview`, `signup`). */
  event: string;
  /** ISO-8601 timestamp the event was emitted. */
  timestamp: string;
  /** PostHog person identifier (anonymous distinct_id or user UUID). */
  distinctId: string | null;
  /** Free-form event properties. PostHog stores these as JSON. */
  properties: Record<string, unknown>;
}

export interface PostHogSessionRecording {
  /** PostHog session ID. */
  id: string;
  /** PostHog UI URL for the recording (used in PR descriptions). */
  url: string;
  /** Recording start (ISO-8601). */
  startTime: string;
  /** Recording end (ISO-8601). May be `null` for ongoing sessions. */
  endTime: string | null;
  /** Total duration in seconds (PostHog computes this server-side). */
  durationSeconds: number | null;
  /** Person identifier of the user who produced the session. */
  distinctId: string | null;
  /** Number of click events in the recording, when known. */
  clickCount: number | null;
  /** Total page-views observed in the recording, when known. */
  pageviewCount: number | null;
}
