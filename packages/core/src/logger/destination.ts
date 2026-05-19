export type LogDestination =
  | { readonly kind: 'stderr' }
  | { readonly kind: 'stdout' }
  | { readonly kind: 'file'; readonly path: string };

/**
 * Resolve where pino logs should be written based on the `SPEX_LOG_DEST` env
 * variable. Supported values:
 *
 * - unset or `stderr` → fd 2 (default; safe for stdio MCP transport)
 * - `stdout`          → fd 1 (NOT safe for stdio MCP — explicit opt-in only)
 * - `file:<path>`     → append to `<path>`
 *
 * Any other value falls back to `stderr` so misconfiguration cannot corrupt
 * the MCP protocol on stdout.
 */
export function resolveLogDestination(env: NodeJS.ProcessEnv = process.env): LogDestination {
  const raw = env.SPEX_LOG_DEST;
  if (raw === undefined || raw === '' || raw === 'stderr') {
    return { kind: 'stderr' };
  }
  if (raw === 'stdout') {
    return { kind: 'stdout' };
  }
  if (raw.startsWith('file:')) {
    const path = raw.slice('file:'.length);
    if (path.length > 0) {
      return { kind: 'file', path };
    }
  }
  return { kind: 'stderr' };
}
