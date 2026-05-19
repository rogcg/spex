import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { type ToolDependencies, registerTools } from './tools/index.js';

export const SPEX_MCP_SERVER_NAME = 'spex';
export const SPEX_MCP_SERVER_VERSION = '0.3.0';

export interface CreateSpexMcpServerOptions {
  /**
   * Tool dependencies. Tests pass mocks; production omits this and the
   * handlers construct defaults (Anthropic LLM, real scaffolder/git).
   */
  toolDeps?: ToolDependencies;
}

export interface StartMcpServerOptions extends CreateSpexMcpServerOptions {
  /**
   * Transport to attach to the server. Defaults to a `StdioServerTransport`
   * reading from `process.stdin` and writing to `process.stdout`. Tests pass an
   * `InMemoryTransport` to exercise the protocol without touching stdio.
   */
  transport?: Transport;
}

/**
 * Construct a SPEX MCP server with `spex_new` and `spex_implement` registered
 * as tools. The server advertises the `tools` capability and responds to
 * `tools/list` and `tools/call` requests.
 */
export function createSpexMcpServer(options: CreateSpexMcpServerOptions = {}): Server {
  const server = new Server(
    {
      name: SPEX_MCP_SERVER_NAME,
      version: SPEX_MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  registerTools(server, options.toolDeps ?? {});

  return server;
}

/**
 * Construct the server and attach it to a transport. Returns the connected
 * server instance so callers can register additional handlers or, in tests,
 * inspect protocol state.
 */
export async function startMcpServer(options: StartMcpServerOptions = {}): Promise<Server> {
  const server = createSpexMcpServer(options.toolDeps ? { toolDeps: options.toolDeps } : {});
  const transport = options.transport ?? new StdioServerTransport();
  await server.connect(transport);
  return server;
}
