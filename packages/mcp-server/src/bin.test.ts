import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const BIN = resolve(HERE, '..', 'dist', 'bin.js');

// The MCP protocol uses JSON-RPC 2.0 framed by newlines on stdio. We send an
// `initialize` request and then immediately close stdin to exit the server.
function buildInitializeMessage(): string {
  const message = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      clientInfo: { name: 'spex-bin-test', version: '0.0.0' },
      capabilities: {},
    },
  };
  return `${JSON.stringify(message)}\n`;
}

describe('@spex/mcp-server binary', () => {
  it('writes only valid JSON-RPC to stdout when started over stdio', async () => {
    const child = execa('node', [BIN], {
      input: buildInitializeMessage(),
      reject: false,
      timeout: 10_000,
      env: { ...process.env, SPEX_LOG_LEVEL: 'info' },
    });

    const result = await child;
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';

    // Every non-empty stdout line MUST parse as JSON-RPC. A single misplaced
    // banner or pino write would corrupt this.
    const lines = stdout.split('\n').filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.jsonrpc).toBe('2.0');
    }

    // The server emits at least one structured log line on stderr (startup
    // banner from the bin entry) — proves logging routes to stderr.
    expect(stderr).toContain('SPEX MCP server connected');
    // And NO log line leaks onto stdout.
    expect(stdout).not.toContain('SPEX MCP server connected');
  });

  it('routes logs to a file when SPEX_LOG_DEST=file:<path>', async () => {
    const { mkdtemp, readFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const workDir = await mkdtemp(join(tmpdir(), 'spex-mcp-bin-'));
    const logFile = join(workDir, 'spex.log');
    try {
      const child = execa('node', [BIN], {
        input: buildInitializeMessage(),
        reject: false,
        timeout: 10_000,
        env: {
          ...process.env,
          SPEX_LOG_DEST: `file:${logFile}`,
          SPEX_LOG_LEVEL: 'info',
        },
      });
      const result = await child;
      const stdout = typeof result.stdout === 'string' ? result.stdout : '';
      const stderr = typeof result.stderr === 'string' ? result.stderr : '';

      // Stdout still parses as JSON-RPC.
      const lines = stdout.split('\n').filter((line) => line.length > 0);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.jsonrpc).toBe('2.0');
      }

      // Logs landed in the file, not stderr.
      const fileContent = await readFile(logFile, 'utf8');
      expect(fileContent).toContain('SPEX MCP server connected');
      expect(stderr).not.toContain('SPEX MCP server connected');
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
