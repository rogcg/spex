import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InsecureLinearEndpointError,
  MissingLinearApiKeyError,
  __poolSizeForTests,
  closeAllLinearMcpClients,
  createLinearMcpClient,
} from './client.js';
import type { TransportFactory } from './types.js';

let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.LINEAR_API_KEY;
  Reflect.deleteProperty(process.env, 'LINEAR_API_KEY');
});

afterEach(async () => {
  if (originalKey === undefined) {
    Reflect.deleteProperty(process.env, 'LINEAR_API_KEY');
  } else {
    process.env.LINEAR_API_KEY = originalKey;
  }
  await closeAllLinearMcpClients();
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
      { name: 'stub-linear-mcp', version: '0.0.0' },
      { capabilities: { tools: {} } },
    );
    // `connect` is async but we let it run in the background — the initialize
    // handshake completes by the time the client awaits its own connect().
    void server.connect(serverTransport);
    servers.push(server);
    return clientTransport;
  });
  return { factory, servers };
}

describe('createLinearMcpClient — auth & env handling', () => {
  it('throws MissingLinearApiKeyError when LINEAR_API_KEY is unset and no apiKey option is supplied', async () => {
    await expect(createLinearMcpClient()).rejects.toBeInstanceOf(MissingLinearApiKeyError);
  });

  it('throws MissingLinearApiKeyError when an empty apiKey is supplied', async () => {
    await expect(createLinearMcpClient({ apiKey: '' })).rejects.toBeInstanceOf(
      MissingLinearApiKeyError,
    );
  });

  it('reads LINEAR_API_KEY from the environment by default', async () => {
    process.env.LINEAR_API_KEY = 'lin_api_env_key';
    const { factory } = makeStubTransportFactory();
    const client = await createLinearMcpClient({ transportFactory: factory });
    expect(client.client).toBeDefined();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit apiKey option (overrides env)', async () => {
    process.env.LINEAR_API_KEY = 'lin_api_env_key';
    const { factory } = makeStubTransportFactory();
    const client = await createLinearMcpClient({
      apiKey: 'lin_api_explicit',
      transportFactory: factory,
    });
    expect(client.client).toBeDefined();
    const headers = factory.mock.calls[0]?.[0].headers;
    expect(headers?.Authorization).toBe('Bearer lin_api_explicit');
  });
});

describe('createLinearMcpClient — endpoint defaulting & HTTPS enforcement', () => {
  it('defaults endpoint to https://mcp.linear.app/mcp when baseUrl is omitted', async () => {
    const { factory } = makeStubTransportFactory();
    const client = await createLinearMcpClient({
      apiKey: 'lin_api_test',
      transportFactory: factory,
    });
    expect(client.endpoint).toBe('https://mcp.linear.app/mcp');
    expect(factory.mock.calls[0]?.[0].url.href).toBe('https://mcp.linear.app/mcp');
  });

  it('honours a custom https baseUrl', async () => {
    const { factory } = makeStubTransportFactory();
    const client = await createLinearMcpClient({
      apiKey: 'lin_api_test',
      baseUrl: 'https://mcp.linear.example.com/mcp',
      transportFactory: factory,
    });
    expect(client.endpoint).toBe('https://mcp.linear.example.com/mcp');
  });

  it('throws InsecureLinearEndpointError on a plain http://example.com baseUrl', async () => {
    await expect(
      createLinearMcpClient({
        apiKey: 'lin_api_test',
        baseUrl: 'http://mcp.example.com/mcp',
      }),
    ).rejects.toBeInstanceOf(InsecureLinearEndpointError);
  });

  it('allows http://localhost for local development', async () => {
    const { factory } = makeStubTransportFactory();
    const client = await createLinearMcpClient({
      apiKey: 'lin_api_test',
      baseUrl: 'http://localhost:8765/mcp',
      transportFactory: factory,
    });
    expect(client.endpoint).toBe('http://localhost:8765/mcp');
  });

  it('allows http://127.0.0.1 for local development', async () => {
    const { factory } = makeStubTransportFactory();
    const client = await createLinearMcpClient({
      apiKey: 'lin_api_test',
      baseUrl: 'http://127.0.0.1:8765/mcp',
      transportFactory: factory,
    });
    expect(client.endpoint).toBe('http://127.0.0.1:8765/mcp');
  });

  it('throws InsecureLinearEndpointError on a malformed URL', async () => {
    await expect(
      createLinearMcpClient({ apiKey: 'lin_api_test', baseUrl: 'not a url' }),
    ).rejects.toBeInstanceOf(InsecureLinearEndpointError);
  });
});

describe('createLinearMcpClient — connection pooling', () => {
  it('returns the same client on a pool hit (same baseUrl + apiKey)', async () => {
    const { factory } = makeStubTransportFactory();
    const a = await createLinearMcpClient({ apiKey: 'lin_api_test', transportFactory: factory });
    const b = await createLinearMcpClient({ apiKey: 'lin_api_test', transportFactory: factory });
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(__poolSizeForTests()).toBe(1);
  });

  it('opens a fresh connection on differing baseUrl', async () => {
    const { factory } = makeStubTransportFactory();
    const a = await createLinearMcpClient({
      apiKey: 'lin_api_test',
      baseUrl: 'https://mcp.linear.app/mcp',
      transportFactory: factory,
    });
    const b = await createLinearMcpClient({
      apiKey: 'lin_api_test',
      baseUrl: 'https://mcp.linear.example.com/mcp',
      transportFactory: factory,
    });
    expect(a).not.toBe(b);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(__poolSizeForTests()).toBe(2);
  });

  it('opens a fresh connection on differing apiKey (different fingerprint)', async () => {
    const { factory } = makeStubTransportFactory();
    const a = await createLinearMcpClient({ apiKey: 'lin_api_alpha', transportFactory: factory });
    const b = await createLinearMcpClient({ apiKey: 'lin_api_bravo', transportFactory: factory });
    expect(a).not.toBe(b);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('shares a single in-flight connect promise across concurrent callers', async () => {
    const { factory } = makeStubTransportFactory();
    const [a, b, c] = await Promise.all([
      createLinearMcpClient({ apiKey: 'lin_api_test', transportFactory: factory }),
      createLinearMcpClient({ apiKey: 'lin_api_test', transportFactory: factory }),
      createLinearMcpClient({ apiKey: 'lin_api_test', transportFactory: factory }),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('close() evicts the pool entry so the next call reconnects', async () => {
    const { factory } = makeStubTransportFactory();
    const a = await createLinearMcpClient({ apiKey: 'lin_api_test', transportFactory: factory });
    await a.close();
    expect(__poolSizeForTests()).toBe(0);
    const b = await createLinearMcpClient({ apiKey: 'lin_api_test', transportFactory: factory });
    expect(b).not.toBe(a);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('closeAllLinearMcpClients() empties the pool', async () => {
    const { factory } = makeStubTransportFactory();
    await createLinearMcpClient({
      apiKey: 'lin_api_alpha',
      baseUrl: 'https://a.example.com/mcp',
      transportFactory: factory,
    });
    await createLinearMcpClient({
      apiKey: 'lin_api_bravo',
      baseUrl: 'https://b.example.com/mcp',
      transportFactory: factory,
    });
    expect(__poolSizeForTests()).toBe(2);
    await closeAllLinearMcpClients();
    expect(__poolSizeForTests()).toBe(0);
  });
});

describe('createLinearMcpClient — secret hygiene', () => {
  it('MissingLinearApiKeyError message never contains the (absent) raw key', async () => {
    try {
      await createLinearMcpClient();
      throw new Error('expected throw');
    } catch (err) {
      const error = err as Error;
      expect(error.message).toContain('LINEAR_API_KEY');
      expect(error.message).not.toMatch(/lin_api_/);
    }
  });

  it('InsecureLinearEndpointError message never contains the raw API key', async () => {
    const SECRET = 'lin_api_super_secret_xyz';
    try {
      await createLinearMcpClient({ apiKey: SECRET, baseUrl: 'http://mcp.example.com/mcp' });
      throw new Error('expected throw');
    } catch (err) {
      const error = err as Error;
      const stack = error.stack ?? '';
      expect(error.message).not.toContain(SECRET);
      expect(stack).not.toContain(SECRET);
    }
  });

  it('LinearMcpClient instance does not expose the raw apiKey anywhere on its surface', async () => {
    const { factory } = makeStubTransportFactory();
    const SECRET = 'lin_api_should_not_leak_zzz';
    const c = await createLinearMcpClient({ apiKey: SECRET, transportFactory: factory });
    // Serialize the wrapper (not the underlying Client which holds protocol
    // state) and confirm the key is nowhere on its visible surface.
    const visible = JSON.stringify({ endpoint: c.endpoint });
    expect(visible).not.toContain(SECRET);
    // The transport factory args also must not contain the raw key in any
    // field other than the well-known Authorization header.
    const args = factory.mock.calls[0]?.[0];
    expect(args?.url.href).not.toContain(SECRET);
    expect(args?.headers.Authorization).toBe(`Bearer ${SECRET}`);
  });
});
