import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { SpexError } from '@spex/core';
import type {
  CreatePostHogMcpClientOptions,
  PostHogMcpClient,
  PostHogMcpClientCacheKey,
  TransportFactory,
} from './types.js';

const DEFAULT_BASE_URL = 'https://mcp.posthog.com/mcp';
const DEFAULT_CLIENT_NAME = 'spex';
const DEFAULT_CLIENT_VERSION = '0.6.0';
const API_KEY_ENV_VAR = 'POSTHOG_API_KEY';
const PROJECT_ID_ENV_VAR = 'POSTHOG_PROJECT_ID';

export class MissingPostHogApiKeyError extends SpexError {
  readonly envVar: string;

  constructor(envVar: string) {
    super(
      `Missing required environment variable: ${envVar}. Generate a PostHog personal API key with the "MCP Server" preset at https://posthog.com (Settings → User → Personal API Keys) and set ${envVar} before running this command.`,
    );
    this.envVar = envVar;
  }
}

export class InsecurePostHogEndpointError extends SpexError {
  readonly endpoint: string;

  constructor(endpoint: string) {
    // The endpoint is the URL only — no API key is ever interpolated here.
    super(
      `Refusing to send a PostHog API key over an insecure endpoint: ${endpoint}. Use https:// or a localhost address.`,
    );
    this.endpoint = endpoint;
  }
}

function assertSecureEndpoint(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new InsecurePostHogEndpointError(rawUrl);
  }
  if (parsed.protocol === 'https:') return parsed;
  if (
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  ) {
    return parsed;
  }
  throw new InsecurePostHogEndpointError(rawUrl);
}

function fingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

function cacheKeyString(key: PostHogMcpClientCacheKey): string {
  return `${key.baseUrl}::${key.apiKeyFingerprint}`;
}

interface PoolEntry {
  promise: Promise<PostHogMcpClient>;
}

const pool = new Map<string, PoolEntry>();

/**
 * Create (or retrieve from the in-process pool) an authenticated MCP client
 * connected to the PostHog MCP server. Concurrent callers with the same
 * `(baseUrl, apiKey)` share a single in-flight connection attempt.
 *
 * Errors are deliberately scrubbed of the API key so they are safe to log.
 */
export async function createPostHogMcpClient(
  options: CreatePostHogMcpClientOptions = {},
): Promise<PostHogMcpClient> {
  const clientName = options.clientName ?? DEFAULT_CLIENT_NAME;
  const clientVersion = options.clientVersion ?? DEFAULT_CLIENT_VERSION;
  const projectId = options.projectId ?? process.env[PROJECT_ID_ENV_VAR];
  const resolvedProjectId = projectId === '' ? undefined : projectId;

  // Custom-transport path: tests inject a transport directly. Pooling does
  // not apply because the caller already owns the transport's lifecycle.
  if (options.transport !== undefined) {
    return openClient({
      transport: options.transport,
      endpoint: null,
      clientName,
      clientVersion,
      projectId: resolvedProjectId,
      onClose: async () => {
        /* no-op: caller owns the transport */
      },
    });
  }

  const apiKey = options.apiKey ?? process.env[API_KEY_ENV_VAR];
  if (apiKey === undefined || apiKey.length === 0) {
    throw new MissingPostHogApiKeyError(API_KEY_ENV_VAR);
  }

  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const url = assertSecureEndpoint(baseUrl);

  const key = cacheKeyString({ baseUrl, apiKeyFingerprint: fingerprint(apiKey) });
  const existing = pool.get(key);
  if (existing !== undefined) {
    return existing.promise;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  const defaultFactory: TransportFactory = (args) =>
    new StreamableHTTPClientTransport(args.url, {
      requestInit: { headers: args.headers },
      ...(options.fetchImpl !== undefined ? { fetch: options.fetchImpl } : {}),
    }) as Transport;
  const buildTransport: TransportFactory = options.transportFactory ?? defaultFactory;

  const promise = (async () => {
    const transport = buildTransport({ url, headers });
    return openClient({
      transport,
      endpoint: baseUrl,
      clientName,
      clientVersion,
      projectId: resolvedProjectId,
      onClose: async () => {
        pool.delete(key);
      },
    });
  })();

  // Eviction on early failure: if connect() throws, the entry must not stick
  // around poisoning future callers.
  promise.catch(() => {
    pool.delete(key);
  });

  pool.set(key, { promise });
  return promise;
}

interface OpenClientArgs {
  transport: Transport;
  endpoint: string | null;
  clientName: string;
  clientVersion: string;
  projectId: string | undefined;
  onClose: () => Promise<void>;
}

async function openClient(args: OpenClientArgs): Promise<PostHogMcpClient> {
  const client = new Client(
    { name: args.clientName, version: args.clientVersion },
    { capabilities: {} },
  );
  await client.connect(args.transport);

  let closed = false;
  return {
    client,
    endpoint: args.endpoint,
    projectId: args.projectId,
    async close() {
      if (closed) return;
      closed = true;
      await args.onClose();
      await client.close();
    },
  };
}

/**
 * Tear down every pooled PostHog MCP connection. Intended for graceful CLI
 * shutdown paths and test teardown. Idempotent.
 */
export async function closeAllPostHogMcpClients(): Promise<void> {
  const entries = Array.from(pool.values());
  pool.clear();
  await Promise.allSettled(
    entries.map(async (entry) => {
      try {
        const c = await entry.promise;
        await c.client.close();
      } catch {
        // The entry never finished connecting; nothing to close.
      }
    }),
  );
}

/** Test-only: peek at the pool size. Not exported from `index.ts`. */
export function __poolSizeForTests(): number {
  return pool.size;
}
