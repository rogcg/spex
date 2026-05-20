import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import {
  SPEX_MCP_SERVER_NAME,
  SPEX_MCP_SERVER_VERSION,
  createSpexMcpServer,
  startMcpServer,
} from './server.js';

describe('createSpexMcpServer', () => {
  it('returns a Server instance without connecting it', async () => {
    const server = createSpexMcpServer();
    expect(server).toBeDefined();
    // The server has not been connected, so `close` resolves cleanly without
    // any transport teardown.
    await server.close();
  });
});

describe('startMcpServer (via InMemoryTransport)', () => {
  it('completes the MCP initialize handshake with a connected client', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const server = await startMcpServer({ transport: serverTransport });

    const client = new Client({ name: 'spex-test-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);

    const serverInfo = client.getServerVersion();
    expect(serverInfo?.name).toBe(SPEX_MCP_SERVER_NAME);
    expect(serverInfo?.version).toBe(SPEX_MCP_SERVER_VERSION);

    const capabilities = client.getServerCapabilities();
    expect(capabilities?.tools).toBeDefined();

    await client.close();
    await server.close();
  });

  it('advertises spex_*, list_skills, and get_skill via tools/list', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = await startMcpServer({ transport: serverTransport });
    const client = new Client({ name: 'spex-test-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);

    const result = await client.listTools();
    expect(Array.isArray(result.tools)).toBe(true);
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_skill',
      'list_skills',
      'spex_fix',
      'spex_implement',
      'spex_new',
      'spex_resume',
      'spex_review',
    ]);

    await client.close();
    await server.close();
  });

  it('dispatches tools/call to the registered handler and returns its result', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = await startMcpServer({ transport: serverTransport });
    const client = new Client({ name: 'spex-test-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);

    // Calling spex_implement with an invalid input is the cheapest way to
    // verify the call/dispatch wiring without invoking the LLM. The handler
    // validates the zod input and returns `isError: true`.
    const result = await client.callTool({ name: 'spex_implement', arguments: {} });
    expect(result.isError).toBe(true);
    const first = (result.content as Array<{ type: string; text?: string }>)[0];
    expect(first?.type).toBe('text');
    expect(first?.text).toContain('Invalid input');

    await client.close();
    await server.close();
  });

  it('returns an error for unknown tool names', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = await startMcpServer({ transport: serverTransport });
    const client = new Client({ name: 'spex-test-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);

    const result = await client.callTool({ name: 'spex_does_not_exist', arguments: {} });
    expect(result.isError).toBe(true);
    const first = (result.content as Array<{ type: string; text?: string }>)[0];
    expect(first?.text).toContain('Unknown tool');

    await client.close();
    await server.close();
  });

  it('reports the SPEX server identity that downstream consumers will see', () => {
    expect(SPEX_MCP_SERVER_NAME).toBe('spex');
    expect(SPEX_MCP_SERVER_VERSION).toBe('0.3.0');
  });
});
