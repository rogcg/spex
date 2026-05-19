#!/usr/bin/env node

// Marker import keeps this file as an ES module under tsc with
// --isolatedModules / module resolution. Pull in `process` from node:process
// instead of relying on the global so the import isn't elidable.
import { env, exit } from 'node:process';

// CRITICAL: The stdio MCP transport reserves stdout for the JSON-RPC protocol.
// Any unprotected writer to fd 1 — pino, console.log, an errant print —
// would corrupt the framing and disconnect every client. We force the default
// before any module that might lazily create a logger gets imported.
if (env.SPEX_LOG_DEST === undefined) {
  env.SPEX_LOG_DEST = 'stderr';
}

const { startMcpServer } = await import('./server.js');
const { createLogger } = await import('@spex/core');

const log = createLogger({ name: 'spex-mcp' });

try {
  await startMcpServer();
  log.info('SPEX MCP server connected over stdio');
} catch (error) {
  log.error(
    { err: error instanceof Error ? { message: error.message, stack: error.stack } : error },
    'SPEX MCP server failed to start',
  );
  exit(1);
}
