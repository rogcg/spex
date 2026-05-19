import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runReviewCommand } from './review.js';

let projectDir: string;
let originalToken: string | undefined;
let originalApiKey: string | undefined;
let originalCwd: string;
let errSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  projectDir = join(
    tmpdir(),
    `spex-review-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(projectDir, { recursive: true });
  originalCwd = process.cwd();
  process.chdir(projectDir);

  originalToken = process.env.GITHUB_TOKEN;
  originalApiKey = process.env.ANTHROPIC_API_KEY;
  Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
  Reflect.deleteProperty(process.env, 'ANTHROPIC_API_KEY');

  process.exitCode = 0;
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalToken === undefined) Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
  else process.env.GITHUB_TOKEN = originalToken;
  if (originalApiKey === undefined) Reflect.deleteProperty(process.env, 'ANTHROPIC_API_KEY');
  else process.env.ANTHROPIC_API_KEY = originalApiKey;
  errSpy.mockRestore();
  logSpy.mockRestore();
  process.exitCode = 0;
});

describe('runReviewCommand argument handling', () => {
  it('errors when the PR ref is missing', async () => {
    await runReviewCommand(undefined);
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalled();
  });

  it('errors on an invalid PR ref (not a number or URL)', async () => {
    await runReviewCommand('not-a-pr');
    expect(process.exitCode).toBe(1);
  });

  it('errors when owner/repo cannot be determined from ref + config', async () => {
    // Bare number, no .ai/config.yaml in projectDir.
    await runReviewCommand('42');
    expect(process.exitCode).toBe(1);
    const lastErr = errSpy.mock.calls.at(-1)?.[0] ?? '';
    expect(String(lastErr)).toMatch(/owner\/repo/);
  });

  it('errors when GITHUB_TOKEN is missing (URL form supplies owner/repo)', async () => {
    await runReviewCommand('https://github.com/example-org/r/pull/42');
    expect(process.exitCode).toBe(1);
    const lastErr = errSpy.mock.calls.at(-1)?.[0] ?? '';
    expect(String(lastErr)).toMatch(/GITHUB_TOKEN/);
  });

  it('errors when ANTHROPIC_API_KEY is missing', async () => {
    process.env.GITHUB_TOKEN = 'gh-tok';
    await runReviewCommand('https://github.com/example-org/r/pull/42');
    expect(process.exitCode).toBe(1);
    const lastErr = errSpy.mock.calls.at(-1)?.[0] ?? '';
    expect(String(lastErr)).toMatch(/ANTHROPIC_API_KEY/);
  });
});
