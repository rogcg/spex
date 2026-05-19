import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CLI = resolve(HERE, '..', '..', 'dist', 'index.js');

function initializeMessage(): string {
  return `${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      clientInfo: { name: 'spex-cli-mcp-test', version: '0.0.0' },
      capabilities: {},
    },
  })}\n`;
}

describe('spex mcp-server (built CLI binary)', () => {
  it('writes only valid JSON-RPC to stdout in default (stdio) mode', async () => {
    const result = await execa('node', [CLI, 'mcp-server'], {
      input: initializeMessage(),
      reject: false,
      timeout: 10_000,
    });
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';

    // Banner from the CLI was NOT written to stdout.
    expect(stdout).not.toContain('SPEX');
    expect(stdout).not.toContain('Spec-driven');

    const lines = stdout.split('\n').filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.jsonrpc).toBe('2.0');
    }

    // Server logged a startup message on stderr.
    expect(stderr).toContain('SPEX MCP server listening on stdio');
  });

  it('rejects --port with a clear error on stderr', async () => {
    const result = await execa('node', [CLI, 'mcp-server', '--port', '8080'], {
      reject: false,
      timeout: 5_000,
    });
    expect(result.exitCode).toBe(1);
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    expect(stderr).toContain('HTTP transport is not supported yet');
  });

  it('rejects an unknown --transport value', async () => {
    const result = await execa('node', [CLI, 'mcp-server', '--transport', 'http'], {
      reject: false,
      timeout: 5_000,
    });
    expect(result.exitCode).toBe(1);
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    expect(stderr).toContain('unsupported transport "http"');
  });
});
