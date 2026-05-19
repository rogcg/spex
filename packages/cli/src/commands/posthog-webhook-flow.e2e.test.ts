import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// End-to-end coverage for `spex posthog-webhook` against the built CLI binary.
// Uses --dry-run so no real LLM / git / GitHub side-effects happen.

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CLI = resolve(HERE, '..', '..', 'dist', 'index.js');

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'spex-posthog-webhook-e2e-'));
  await mkdir(join(workDir, '.ai'), { recursive: true });
  await writeFile(
    join(workDir, '.ai', 'config.yaml'),
    [
      'integrations:',
      '  posthog:',
      '    auto_fix:',
      '      enabled: true',
      '      severity: [critical]',
      '      min_occurrences: 5',
      '',
    ].join('\n'),
    'utf8',
  );
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeEventPayload(payload: unknown): Promise<string> {
  const path = join(workDir, 'event.json');
  await writeFile(path, JSON.stringify(payload), 'utf8');
  return path;
}

describe('spex posthog-webhook (built CLI binary, --dry-run)', () => {
  it('triggers when a new_issue event matches severity + min_occurrences', async () => {
    const eventPath = await writeEventPayload({
      type: 'new_issue',
      issue: {
        id: 'iss_abc123',
        level: 'critical',
        occurrences: 42,
        first_seen: '2026-05-15T12:34:56Z',
        last_seen: '2026-05-19T08:12:30Z',
      },
    });
    const result = await execa(
      'node',
      [CLI, 'posthog-webhook', '--payload-path', eventPath, '--dry-run'],
      { cwd: workDir, reject: false, timeout: 10_000 },
    );
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('Event: new_issue');
    expect(stdout).toContain('iss_abc123');
    expect(stdout).toContain('[dry-run]');
    expect(stdout).toContain('--from-error=posthog:iss_abc123');
  });

  it('skips regressions even when severity + occurrences match', async () => {
    const eventPath = await writeEventPayload({
      type: 'regression',
      issue: { id: 'iss_abc123', level: 'critical', occurrences: 100 },
    });
    const result = await execa(
      'node',
      [CLI, 'posthog-webhook', '--payload-path', eventPath, '--dry-run'],
      { cwd: workDir, reject: false, timeout: 10_000 },
    );
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('Skipping auto-fix');
    expect(stdout).toContain('regression');
  });

  it('skips when occurrences is below min_occurrences', async () => {
    const eventPath = await writeEventPayload({
      type: 'new_issue',
      issue: { id: 'iss_abc123', level: 'critical', occurrences: 2 },
    });
    const result = await execa(
      'node',
      [CLI, 'posthog-webhook', '--payload-path', eventPath, '--dry-run'],
      { cwd: workDir, reject: false, timeout: 10_000 },
    );
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('Skipping auto-fix');
    expect(stdout).toContain('min_occurrences=5');
  });

  it('skips when severity is not in the allow-list', async () => {
    const eventPath = await writeEventPayload({
      type: 'new_issue',
      issue: { id: 'iss_abc123', level: 'warning', occurrences: 100 },
    });
    const result = await execa(
      'node',
      [CLI, 'posthog-webhook', '--payload-path', eventPath, '--dry-run'],
      { cwd: workDir, reject: false, timeout: 10_000 },
    );
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('Skipping auto-fix');
    expect(stdout).toContain('warning');
  });

  it('exits 1 when PostHog integration is not configured in .ai/config.yaml', async () => {
    await writeFile(
      join(workDir, '.ai', 'config.yaml'),
      'integrations:\n  linear:\n    team: SPX\n',
      'utf8',
    );
    const eventPath = await writeEventPayload({
      type: 'new_issue',
      issue: { id: 'iss_abc123', level: 'critical', occurrences: 42 },
    });
    const result = await execa(
      'node',
      [CLI, 'posthog-webhook', '--payload-path', eventPath, '--dry-run'],
      { cwd: workDir, reject: false, timeout: 10_000 },
    );
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain('PostHog integration not configured');
  });

  it('exits 1 on signature mismatch when --signature is supplied', async () => {
    const eventPath = await writeEventPayload({
      type: 'new_issue',
      issue: { id: 'iss_abc123', level: 'critical', occurrences: 42 },
    });
    const result = await execa(
      'node',
      [
        CLI,
        'posthog-webhook',
        '--payload-path',
        eventPath,
        '--signature',
        'sha256=0000',
        '--secret',
        'something',
        '--dry-run',
      ],
      { cwd: workDir, reject: false, timeout: 10_000 },
    );
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain('signature did not match');
  });
});
