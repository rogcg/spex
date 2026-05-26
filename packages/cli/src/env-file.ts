import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read `<cwd>/.env` if present and populate `process.env` for keys not already
 * set in the current environment. Shell-exported values always win — this is a
 * fallback, not an override.
 */
export function loadProjectEnv(cwd: string): void {
  const envPath = join(cwd, '.env');
  if (!existsSync(envPath)) return;
  let content: string;
  try {
    content = readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { key, value } = parsed;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Add or replace a `KEY=value` line inside `<projectDir>/.env`. Creates the
 * file if it does not exist. Existing unrelated lines (other keys, comments)
 * are preserved.
 */
export function upsertEnvVar(projectDir: string, key: string, value: string): void {
  const envPath = join(projectDir, '.env');
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `${key}=${value}\n`, 'utf8');
    return;
  }
  const content = readFileSync(envPath, 'utf8');
  const lines = content.split('\n');
  const idx = lines.findIndex((line) => {
    const parsed = parseLine(line);
    return parsed?.key === key;
  });
  if (idx >= 0) {
    lines[idx] = `${key}=${value}`;
  } else {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
    lines.push(`${key}=${value}`);
    lines.push('');
  }
  writeFileSync(envPath, lines.join('\n'), 'utf8');
}

/**
 * Ensure `<projectDir>/.gitignore` ignores `.env`. No-op if the file does not
 * exist (scaffolders own the initial `.gitignore`) or already lists `.env`.
 */
export function ensureEnvGitignored(projectDir: string): void {
  const path = join(projectDir, '.gitignore');
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  const alreadyIgnored = content.split(/\r?\n/).some((line) => line.trim() === '.env');
  if (alreadyIgnored) return;
  const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  appendFileSync(path, `${prefix}.env\n`, 'utf8');
}

function parseLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}
