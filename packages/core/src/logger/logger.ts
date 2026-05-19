import pino, { type DestinationStream, type Logger } from 'pino';
import { type LogDestination, resolveLogDestination } from './destination.js';

export interface CreateLoggerOptions {
  /** Override the destination. By default reads `SPEX_LOG_DEST` from the env. */
  destination?: LogDestination;
  /** Pino logger name. Defaults to `spex`. */
  name?: string;
  /**
   * Pino log level. Defaults to `SPEX_LOG_LEVEL` from the env, then `info`.
   */
  level?: string;
  /** Sync writes — required when tests assert on output. Defaults to true. */
  sync?: boolean;
}

/**
 * Create a pino logger routed to the destination indicated by `SPEX_LOG_DEST`.
 * The default destination is **stderr** so that nothing accidentally writes to
 * stdout — which would corrupt the MCP stdio protocol.
 *
 * Loggers created here are independent (own destination stream). Callers who
 * want a shared logger should construct one at module init and re-use it.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const destination = options.destination ?? resolveLogDestination();
  const stream = openDestinationStream(destination, options.sync ?? true);
  const name = options.name ?? 'spex';
  const level = options.level ?? process.env.SPEX_LOG_LEVEL ?? 'info';

  return pino({ name, level }, stream);
}

function openDestinationStream(destination: LogDestination, sync: boolean): DestinationStream {
  switch (destination.kind) {
    case 'stderr':
      return pino.destination({ dest: 2, sync });
    case 'stdout':
      return pino.destination({ dest: 1, sync });
    case 'file':
      return pino.destination({ dest: destination.path, sync, mkdir: true });
  }
}
