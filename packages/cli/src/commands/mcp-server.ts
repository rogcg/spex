import { stderr } from 'node:process';
import type { startMcpServer as StartMcpServerFn } from '@spex/mcp-server';
import { STRINGS } from '../strings.js';

// @spex/cli does not depend directly on @modelcontextprotocol/sdk, so we
// recover the connected `Server` shape from the public `startMcpServer`
// signature instead of importing it from the SDK.
type ConnectedServer = Awaited<ReturnType<typeof StartMcpServerFn>>;

export interface RunMcpServerCommandOptions {
  transport?: string;
  port?: string;
}

/**
 * Start SPEX in MCP server mode. Listens on stdio by default; logs to stderr.
 *
 * IMPORTANT: This command MUST NOT write anything to stdout — the MCP stdio
 * transport reserves stdout for JSON-RPC framing. The caller in `cli/index.ts`
 * skips `printBanner()` for this action accordingly.
 */
export async function runMcpServerCommand(options: RunMcpServerCommandOptions = {}): Promise<void> {
  if (options.port !== undefined && options.port !== '') {
    stderr.write(`${STRINGS.mcpServerCommand.httpNotSupported}\n`);
    process.exit(1);
  }
  const transport = options.transport ?? 'stdio';
  if (transport !== 'stdio') {
    stderr.write(`${STRINGS.mcpServerCommand.unsupportedTransport(transport)}\n`);
    process.exit(1);
  }

  // Force stderr default BEFORE we import any module that might lazily
  // construct a logger that defaults to fd 1. We do this in addition to the
  // mcp-server's bin entry because the CLI command bypasses that bin.
  if (process.env.SPEX_LOG_DEST === undefined) {
    process.env.SPEX_LOG_DEST = 'stderr';
  }

  const { startMcpServer } = await import('@spex/mcp-server');
  const { createLogger } = await import('@spex/core');
  const log = createLogger({ name: 'spex-mcp-cli' });

  let server: ConnectedServer;
  try {
    server = await startMcpServer();
  } catch (cause) {
    log.error(
      {
        err: cause instanceof Error ? { message: cause.message, stack: cause.stack } : cause,
      },
      'SPEX MCP server failed to start',
    );
    process.exit(1);
  }

  log.info(STRINGS.mcpServerCommand.startupMessage);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    log.info({ signal }, STRINGS.mcpServerCommand.shutdownMessage(signal));
    try {
      await server.close();
    } catch (cause) {
      log.error(
        {
          err: cause instanceof Error ? { message: cause.message, stack: cause.stack } : cause,
        },
        'Error during shutdown',
      );
    }
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  // The StdioServerTransport keeps stdin attached, which keeps the event loop
  // alive. When the IDE closes the pipe (EOF on stdin), the transport's
  // onclose fires and the process exits naturally.
}
