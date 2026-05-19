import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readGithubPullRequestEvent } from './linear-sync.js';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'spex-linear-sync-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writePayload(payload: unknown): Promise<string> {
  const path = join(workDir, 'event.json');
  await writeFile(path, JSON.stringify(payload), 'utf8');
  return path;
}

describe('readGithubPullRequestEvent', () => {
  it('maps action=opened → opened', async () => {
    const path = await writePayload({
      action: 'opened',
      pull_request: {
        number: 12,
        html_url: 'https://github.com/x/y/pull/12',
        body: 'Closes SPX-47',
        merged: false,
        head: { ref: 'admin/spx-47-thing' },
      },
    });

    const parsed = await readGithubPullRequestEvent(path);

    expect(parsed.eventKind).toBe('opened');
    expect(parsed.prNumber).toBe(12);
    expect(parsed.prUrl).toBe('https://github.com/x/y/pull/12');
    expect(parsed.prBody).toBe('Closes SPX-47');
    expect(parsed.branch).toBe('admin/spx-47-thing');
  });

  it('maps action=reopened → opened', async () => {
    const path = await writePayload({
      action: 'reopened',
      pull_request: { number: 1, html_url: 'u', body: '', merged: false, head: { ref: 'b' } },
    });
    expect((await readGithubPullRequestEvent(path)).eventKind).toBe('opened');
  });

  it('maps action=closed + merged=true → merged', async () => {
    const path = await writePayload({
      action: 'closed',
      pull_request: { number: 1, html_url: 'u', body: '', merged: true, head: { ref: 'b' } },
    });
    expect((await readGithubPullRequestEvent(path)).eventKind).toBe('merged');
  });

  it('maps action=closed + merged=false → closed_unmerged', async () => {
    const path = await writePayload({
      action: 'closed',
      pull_request: { number: 1, html_url: 'u', body: '', merged: false, head: { ref: 'b' } },
    });
    expect((await readGithubPullRequestEvent(path)).eventKind).toBe('closed_unmerged');
  });

  it('tolerates a missing body / branch', async () => {
    const path = await writePayload({
      action: 'opened',
      pull_request: { number: 7, html_url: 'u' },
    });
    const parsed = await readGithubPullRequestEvent(path);
    expect(parsed.prBody).toBe('');
    expect(parsed.branch).toBe('');
  });

  it('rejects an unsupported action', async () => {
    const path = await writePayload({
      action: 'labeled',
      pull_request: { number: 1, html_url: 'u', merged: false, head: { ref: 'b' } },
    });
    await expect(readGithubPullRequestEvent(path)).rejects.toThrow(/unsupported/);
  });

  it('rejects payload missing pull_request', async () => {
    const path = await writePayload({ action: 'opened' });
    await expect(readGithubPullRequestEvent(path)).rejects.toThrow(/pull_request/);
  });

  it('rejects payload missing pull_request.number', async () => {
    const path = await writePayload({
      action: 'opened',
      pull_request: { html_url: 'u', merged: false },
    });
    await expect(readGithubPullRequestEvent(path)).rejects.toThrow(/number/);
  });

  it('rejects payload missing pull_request.html_url', async () => {
    const path = await writePayload({
      action: 'opened',
      pull_request: { number: 1, merged: false },
    });
    await expect(readGithubPullRequestEvent(path)).rejects.toThrow(/html_url/);
  });
});
