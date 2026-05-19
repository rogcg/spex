import type { Dirent } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = resolve(__dirname, '..', '..', '..', '..');
// Library packages: code that may run inside the MCP server. ANY write to
// stdout (console.log/info/warn or process.stdout.write) would corrupt the
// MCP stdio framing. console.error is fine — that's stderr.
const LIBRARY_PACKAGES = ['core', 'schemas', 'mcp-server'] as const;

// Anti-patterns to ban in library code (CLI is exempt — it owns stdout for UX).
const FORBIDDEN_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  { name: 'console.log', regex: /\bconsole\.log\b/ },
  { name: 'console.info', regex: /\bconsole\.info\b/ },
  { name: 'console.warn', regex: /\bconsole\.warn\b/ },
  { name: 'process.stdout.write', regex: /\bprocess\.stdout\.write\b/ },
];

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      await walk(path, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      // Tests are allowed to set up fixtures with stdout if they need to.
      if (entry.name.endsWith('.test.ts')) continue;
      out.push(path);
    }
  }
}

describe('library packages do not write to stdout', () => {
  for (const pkg of LIBRARY_PACKAGES) {
    it(`@spex/${pkg} has no console.log / process.stdout.write usage`, async () => {
      const srcDir = join(WORKSPACE_ROOT, 'packages', pkg, 'src');
      try {
        await stat(srcDir);
      } catch {
        // Package not yet present; treat as vacuously safe.
        return;
      }

      const files: string[] = [];
      await walk(srcDir, files);

      const violations: string[] = [];
      for (const file of files) {
        const content = await readFile(file, 'utf8');
        const lines = content.split('\n');
        let inBlockComment = false;

        lines.forEach((rawLine, index) => {
          let line = rawLine;

          // Strip block-comment content carried over from previous lines.
          if (inBlockComment) {
            const closer = line.indexOf('*/');
            if (closer === -1) {
              return;
            }
            line = line.slice(closer + 2);
            inBlockComment = false;
          }

          // Strip block comments contained on this line, and detect openers.
          while (true) {
            const open = line.indexOf('/*');
            if (open === -1) break;
            const close = line.indexOf('*/', open + 2);
            if (close === -1) {
              line = line.slice(0, open);
              inBlockComment = true;
              break;
            }
            line = line.slice(0, open) + line.slice(close + 2);
          }

          // Strip inline line comments.
          const slash = line.indexOf('//');
          if (slash !== -1) {
            line = line.slice(0, slash);
          }

          // JSDoc continuation lines start with a leading `*` after whitespace.
          const trimmed = line.trim();
          if (trimmed.startsWith('*')) {
            return;
          }

          for (const pattern of FORBIDDEN_PATTERNS) {
            if (pattern.regex.test(line)) {
              violations.push(`${file}:${index + 1}: ${pattern.name} → "${rawLine.trim()}"`);
            }
          }
        });
      }

      expect(violations, violations.join('\n')).toEqual([]);
    });
  }
});
