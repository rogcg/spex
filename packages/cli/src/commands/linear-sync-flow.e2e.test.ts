import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// End-to-end coverage for `spex linear-sync` against the built CLI binary.
// Uses --dry-run so no real Linear API call is made.

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CLI = resolve(HERE, '..', '..', 'dist', 'index.js');

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'spex-linear-sync-e2e-'));
  await mkdir(join(workDir, '.ai'), { recursive: true });
  await writeFile(
    join(workDir, '.ai', 'config.yaml'),
    'integrations:\n  linear:\n    team: SPX\n',
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

describe('spex linear-sync (built CLI binary, --dry-run)', () => {
  it('extracts the Linear id from a `Closes <ID>` PR body and reports the planned sync', async () => {
    const eventPath = await writeEventPayload({
      action: 'opened',
      pull_request: {
        number: 12,
        html_url: 'https://github.com/x/y/pull/12',
        body: 'Closes SPX-47\n\nSome other text.',
        merged: false,
        head: { ref: 'admin/spx-47-thing' },
      },
    });

    const result = await execa(
      'node',
      [CLI, 'linear-sync', '--event-path', eventPath, '--dry-run'],
      {
        cwd: workDir,
        reject: false,
        timeout: 10_000,
      },
    );
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';

    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('[dry-run]');
    expect(stdout).toContain('SPX-47');
    expect(stdout).toContain('event=opened');
    expect(stdout).toContain('PR=#12');
  });

  it('reports the merged event mapping when payload has action=closed + merged=true', async () => {
    const eventPath = await writeEventPayload({
      action: 'closed',
      pull_request: {
        number: 12,
        html_url: 'https://github.com/x/y/pull/12',
        body: 'Closes SPX-47',
        merged: true,
        head: { ref: 'admin/spx-47-thing' },
      },
    });
    const result = await execa(
      'node',
      [CLI, 'linear-sync', '--event-path', eventPath, '--dry-run'],
      { cwd: workDir, reject: false, timeout: 10_000 },
    );
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('event=merged');
  });

  it('reports closed_unmerged when payload has action=closed + merged=false', async () => {
    const eventPath = await writeEventPayload({
      action: 'closed',
      pull_request: {
        number: 12,
        html_url: 'https://github.com/x/y/pull/12',
        body: 'Closes SPX-47',
        merged: false,
        head: { ref: 'admin/spx-47-thing' },
      },
    });
    const result = await execa(
      'node',
      [CLI, 'linear-sync', '--event-path', eventPath, '--dry-run'],
      { cwd: workDir, reject: false, timeout: 10_000 },
    );
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('event=closed_unmerged');
  });

  it('falls back to the branch when PR body has no Linear id', async () => {
    const eventPath = await writeEventPayload({
      action: 'opened',
      pull_request: {
        number: 12,
        html_url: 'https://github.com/x/y/pull/12',
        body: 'No ticket here',
        merged: false,
        head: { ref: 'admin/spx-47-from-branch' },
      },
    });
    const result = await execa(
      'node',
      [CLI, 'linear-sync', '--event-path', eventPath, '--dry-run'],
      { cwd: workDir, reject: false, timeout: 10_000 },
    );
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('SPX-47');
  });

  it('exits 0 with a friendly skip message when no Linear id is found anywhere', async () => {
    const eventPath = await writeEventPayload({
      action: 'opened',
      pull_request: {
        number: 12,
        html_url: 'https://github.com/x/y/pull/12',
        body: 'No ticket',
        merged: false,
        head: { ref: 'main' },
      },
    });
    const result = await execa(
      'node',
      [CLI, 'linear-sync', '--event-path', eventPath, '--dry-run'],
      { cwd: workDir, reject: false, timeout: 10_000 },
    );
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('No Linear issue id detected');
  });

  it('exits 1 with a clear error when Linear integration is missing from config', async () => {
    // Overwrite config to drop the linear section.
    await writeFile(join(workDir, '.ai', 'config.yaml'), 'integrations: {}\n', 'utf8');
    const eventPath = await writeEventPayload({
      action: 'opened',
      pull_request: {
        number: 12,
        html_url: 'https://github.com/x/y/pull/12',
        body: 'Closes SPX-47',
        merged: false,
        head: { ref: 'admin/spx-47' },
      },
    });
    const result = await execa(
      'node',
      [CLI, 'linear-sync', '--event-path', eventPath, '--dry-run'],
      { cwd: workDir, reject: false, timeout: 10_000 },
    );
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain('Linear integration not configured');
  });
});
