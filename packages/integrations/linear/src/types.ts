import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export interface CreateLinearMcpClientOptions {
  /**
   * Linear API key. Defaults to `process.env.LINEAR_API_KEY`. Throws
   * {@link MissingLinearApiKeyError} when both are absent or empty.
   *
   * Generate at https://linear.app/settings/api.
   */
  apiKey?: string;
  /**
   * Linear MCP endpoint URL. Defaults to `https://mcp.linear.app/mcp` (the
   * official Streamable HTTP endpoint). Must be HTTPS unless pointing at
   * `localhost` / `127.0.0.1` — see {@link InsecureLinearEndpointError}.
   */
  baseUrl?: string;
  /**
   * Client implementation name advertised during the MCP handshake. Defaults
   * to `spex`.
   */
  clientName?: string;
  /**
   * Client implementation version advertised during the MCP handshake.
   * Defaults to the current `@spex/integrations-linear` version.
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
 * Arguments passed to a {@link CreateLinearMcpClientOptions.transportFactory}.
 * Never includes the raw API key — only the resolved URL and the headers the
 * default factory would have set.
 */
export interface TransportFactoryArgs {
  url: URL;
  headers: Record<string, string>;
}

export type TransportFactory = (args: TransportFactoryArgs) => Transport;

export interface LinearMcpClient {
  /**
   * Underlying MCP SDK client. Use `client.callTool(...)`, `client.listTools()`,
   * etc. to talk to Linear's MCP server.
   */
  readonly client: Client;
  /**
   * Resolved endpoint URL the transport is connected to. `null` when a custom
   * `transport` was injected (no URL is meaningful in that case).
   */
  readonly endpoint: string | null;
  /**
   * Tear down this pooled connection. Subsequent calls to
   * `createLinearMcpClient(...)` with the same `(baseUrl, apiKey)` will open a
   * fresh connection.
   */
  close(): Promise<void>;
}

/**
 * The shape used internally to key the connection pool. Exposed for tests
 * that need to assert pool behaviour. The raw API key is never stored on this
 * object — only a SHA-256 fingerprint prefix.
 */
export interface LinearMcpClientCacheKey {
  baseUrl: string;
  apiKeyFingerprint: string;
}
