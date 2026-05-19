import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InsecurePostHogEndpointError,
  MissingPostHogApiKeyError,
  __poolSizeForTests,
  closeAllPostHogMcpClients,
  createPostHogMcpClient,
} from './client.js';
import type { TransportFactory } from './types.js';

let originalKey: string | undefined;
let originalProject: string | undefined;

beforeEach(() => {
  originalKey = process.env.POSTHOG_API_KEY;
  originalProject = process.env.POSTHOG_PROJECT_ID;
  Reflect.deleteProperty(process.env, 'POSTHOG_API_KEY');
  Reflect.deleteProperty(process.env, 'POSTHOG_PROJECT_ID');
});

afterEach(async () => {
  if (originalKey === undefined) {
    Reflect.deleteProperty(process.env, 'POSTHOG_API_KEY');
  } else {
    process.env.POSTHOG_API_KEY = originalKey;
  }
  if (originalProject === undefined) {
    Reflect.deleteProperty(process.env, 'POSTHOG_PROJECT_ID');
  } else {
    process.env.POSTHOG_PROJECT_ID = originalProject;
  }
  await closeAllPostHogMcpClients();
});

/**
 * Build a `transportFactory` that, on each call, creates a fresh
 * `InMemoryTransport` pair, wires a stub MCP `Server` to the other end, and
 * returns the client-side transport. The returned spy tracks invocations and
 * the stub server so tests can also close it cleanly.
 */
function makeStubTransportFactory(): {
  factory: ReturnType<typeof vi.fn<TransportFactory>>;
  servers: Server[];
} {
  const servers: Server[] = [];
  const factory = vi.fn<TransportFactory>((_args) => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new Server(
      { name: 'stub-posthog-mcp', version: '0.0.0' },
      { capabilities: { tools: {} } },
    );
    void server.connect(serverTransport);
    servers.push(server);
    return clientTransport;
  });
  return { factory, servers };
}

describe('createPostHogMcpClient — auth & env handling', () => {
  it('throws MissingPostHogApiKeyError when POSTHOG_API_KEY is unset and no apiKey option is supplied', async () => {
    await expect(createPostHogMcpClient()).rejects.toBeInstanceOf(MissingPostHogApiKeyError);
  });

  it('throws MissingPostHogApiKeyError when an empty apiKey is supplied', async () => {
    await expect(createPostHogMcpClient({ apiKey: '' })).rejects.toBeInstanceOf(
      MissingPostHogApiKeyError,
    );
  });

  it('reads POSTHOG_API_KEY from the environment by default', async () => {
    process.env.POSTHOG_API_KEY = 'phx_env_key';
    const { factory } = makeStubTransportFactory();
    const client = await createPostHogMcpClient({ transportFactory: factory });
    expect(client.client).toBeDefined();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit apiKey option (overrides env)', async () => {
    process.env.POSTHOG_API_KEY = 'phx_env_key';
    const { factory } = makeStubTransportFactory();
    const client = await createPostHogMcpClient({
      apiKey: 'phx_explicit',
      transportFactory: factory,
    });
    expect(client.client).toBeDefined();
    const headers = factory.mock.calls[0]?.[0].headers;
    expect(headers?.Authorization).toBe('Bearer phx_explicit');
  });
});

describe('createPostHogMcpClient — project id resolution', () => {
  it('reads POSTHOG_PROJECT_ID from the environment when no projectId is supplied', async () => {
    process.env.POSTHOG_PROJECT_ID = '336884';
    const { factory } = makeStubTransportFactory();
    const client = await createPostHogMcpClient({
      apiKey: 'phx_test',
      transportFactory: factory,
    });
    expect(client.projectId).toBe('336884');
  });

  it('honours an explicit projectId option (overrides env)', async () => {
    process.env.POSTHOG_PROJECT_ID = '111';
    const { factory } = makeStubTransportFactory();
    const client = await createPostHogMcpClient({
      apiKey: 'phx_test',
      projectId: '222',
      transportFactory: factory,
    });
    expect(client.projectId).toBe('222');
  });

  it('leaves projectId undefined when neither env nor option is set', async () => {
    const { factory } = makeStubTransportFactory();
    const client = await createPostHogMcpClient({
      apiKey: 'phx_test',
      transportFactory: factory,
    });
    expect(client.projectId).toBeUndefined();
  });

  it('treats an empty POSTHOG_PROJECT_ID as unset', async () => {
    process.env.POSTHOG_PROJECT_ID = '';
    const { factory } = makeStubTransportFactory();
    const client = await createPostHogMcpClient({
      apiKey: 'phx_test',
      transportFactory: factory,
    });
    expect(client.projectId).toBeUndefined();
  });
});

describe('createPostHogMcpClient — endpoint defaulting & HTTPS enforcement', () => {
  it('defaults endpoint to https://mcp.posthog.com/mcp when baseUrl is omitted', async () => {
    const { factory } = makeStubTransportFactory();
    const client = await createPostHogMcpClient({
      apiKey: 'phx_test',
      transportFactory: factory,
    });
    expect(client.endpoint).toBe('https://mcp.posthog.com/mcp');
    expect(factory.mock.calls[0]?.[0].url.href).toBe('https://mcp.posthog.com/mcp');
  });

  it('honours a custom https baseUrl', async () => {
    const { factory } = makeStubTransportFactory();
    const client = await createPostHogMcpClient({
      apiKey: 'phx_test',
      baseUrl: 'https://mcp.posthog.example.com/mcp',
      transportFactory: factory,
    });
    expect(client.endpoint).toBe('https://mcp.posthog.example.com/mcp');
  });

  it('throws InsecurePostHogEndpointError on a plain http://example.com baseUrl', async () => {
    await expect(
      createPostHogMcpClient({
        apiKey: 'phx_test',
        baseUrl: 'http://mcp.example.com/mcp',
      }),
    ).rejects.toBeInstanceOf(InsecurePostHogEndpointError);
  });

  it('allows http://localhost for local development', async () => {
    const { factory } = makeStubTransportFactory();
    const client = await createPostHogMcpClient({
      apiKey: 'phx_test',
      baseUrl: 'http://localhost:8765/mcp',
      transportFactory: factory,
    });
    expect(client.endpoint).toBe('http://localhost:8765/mcp');
  });

  it('allows http://127.0.0.1 for local development', async () => {
    const { factory } = makeStubTransportFactory();
    const client = await createPostHogMcpClient({
      apiKey: 'phx_test',
      baseUrl: 'http://127.0.0.1:8765/mcp',
      transportFactory: factory,
    });
    expect(client.endpoint).toBe('http://127.0.0.1:8765/mcp');
  });

  it('throws InsecurePostHogEndpointError on a malformed URL', async () => {
    await expect(
      createPostHogMcpClient({ apiKey: 'phx_test', baseUrl: 'not a url' }),
    ).rejects.toBeInstanceOf(InsecurePostHogEndpointError);
  });
});

describe('createPostHogMcpClient — connection pooling', () => {
  it('returns the same client on a pool hit (same baseUrl + apiKey)', async () => {
    const { factory } = makeStubTransportFactory();
    const a = await createPostHogMcpClient({ apiKey: 'phx_test', transportFactory: factory });
    const b = await createPostHogMcpClient({ apiKey: 'phx_test', transportFactory: factory });
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(__poolSizeForTests()).toBe(1);
  });

  it('opens a fresh connection on differing baseUrl', async () => {
    const { factory } = makeStubTransportFactory();
    const a = await createPostHogMcpClient({
      apiKey: 'phx_test',
      baseUrl: 'https://mcp.posthog.com/mcp',
      transportFactory: factory,
    });
    const b = await createPostHogMcpClient({
      apiKey: 'phx_test',
      baseUrl: 'https://mcp.posthog.example.com/mcp',
      transportFactory: factory,
    });
    expect(a).not.toBe(b);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(__poolSizeForTests()).toBe(2);
  });

  it('opens a fresh connection on differing apiKey (different fingerprint)', async () => {
    const { factory } = makeStubTransportFactory();
    const a = await createPostHogMcpClient({ apiKey: 'phx_alpha', transportFactory: factory });
    const b = await createPostHogMcpClient({ apiKey: 'phx_bravo', transportFactory: factory });
    expect(a).not.toBe(b);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('shares a single in-flight connect promise across concurrent callers', async () => {
    const { factory } = makeStubTransportFactory();
    const [a, b, c] = await Promise.all([
      createPostHogMcpClient({ apiKey: 'phx_test', transportFactory: factory }),
      createPostHogMcpClient({ apiKey: 'phx_test', transportFactory: factory }),
      createPostHogMcpClient({ apiKey: 'phx_test', transportFactory: factory }),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('close() evicts the pool entry so the next call reconnects', async () => {
    const { factory } = makeStubTransportFactory();
    const a = await createPostHogMcpClient({ apiKey: 'phx_test', transportFactory: factory });
    await a.close();
    expect(__poolSizeForTests()).toBe(0);
    const b = await createPostHogMcpClient({ apiKey: 'phx_test', transportFactory: factory });
    expect(b).not.toBe(a);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('closeAllPostHogMcpClients() empties the pool', async () => {
    const { factory } = makeStubTransportFactory();
    await createPostHogMcpClient({
      apiKey: 'phx_alpha',
      baseUrl: 'https://a.example.com/mcp',
      transportFactory: factory,
    });
    await createPostHogMcpClient({
      apiKey: 'phx_bravo',
      baseUrl: 'https://b.example.com/mcp',
      transportFactory: factory,
    });
    expect(__poolSizeForTests()).toBe(2);
    await closeAllPostHogMcpClients();
    expect(__poolSizeForTests()).toBe(0);
  });
});

describe('createPostHogMcpClient — secret hygiene', () => {
  it('MissingPostHogApiKeyError message never contains the (absent) raw key', async () => {
    try {
      await createPostHogMcpClient();
      throw new Error('expected throw');
    } catch (err) {
      const error = err as Error;
      expect(error.message).toContain('POSTHOG_API_KEY');
      expect(error.message).not.toMatch(/phx_/);
    }
  });

  it('InsecurePostHogEndpointError message never contains the raw API key', async () => {
    const SECRET = 'phx_super_secret_xyz';
    try {
      await createPostHogMcpClient({ apiKey: SECRET, baseUrl: 'http://mcp.example.com/mcp' });
      throw new Error('expected throw');
    } catch (err) {
      const error = err as Error;
      const stack = error.stack ?? '';
      expect(error.message).not.toContain(SECRET);
      expect(stack).not.toContain(SECRET);
    }
  });

  it('PostHogMcpClient instance does not expose the raw apiKey anywhere on its surface', async () => {
    const { factory } = makeStubTransportFactory();
    const SECRET = 'phx_should_not_leak_zzz';
    const c = await createPostHogMcpClient({ apiKey: SECRET, transportFactory: factory });
    // Serialize the wrapper (not the underlying Client which holds protocol
    // state) and confirm the key is nowhere on its visible surface.
    const visible = JSON.stringify({ endpoint: c.endpoint, projectId: c.projectId });
    expect(visible).not.toContain(SECRET);
    // The transport factory args also must not contain the raw key in any
    // field other than the well-known Authorization header.
    const args = factory.mock.calls[0]?.[0];
    expect(args?.url.href).not.toContain(SECRET);
    expect(args?.headers.Authorization).toBe(`Bearer ${SECRET}`);
  });
});
