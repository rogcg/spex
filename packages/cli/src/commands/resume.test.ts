import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateStore } from '@spex/core';
import type { ScratchState } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runResumeCommand } from './resume.js';

let projectDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'spex-resume-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(async () => {
  logSpy.mockRestore();
  await rm(projectDir, { recursive: true, force: true });
});

function state(overrides: Partial<ScratchState> = {}): ScratchState {
  return {
    version: 1,
    workflowId: 'wf-default',
    kind: 'implementation',
    status: 'paused',
    createdAt: '2026-05-20T10:00:00.000Z',
    updatedAt: '2026-05-20T10:05:00.000Z',
    lastActivityAt: '2026-05-20T10:05:00.000Z',
    ...overrides,
  };
}

describe('runResumeCommand', () => {
  it('reports no workflows when scratch is empty', async () => {
    await runResumeCommand({ projectDir });
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.join('\n')).toContain('No workflows found');
  });

  it('lists workflows when --list is passed', async () => {
    const store = createStateStore({ projectDir });
    await store.save(state({ workflowId: 'wf-1' }));
    await store.save(state({ workflowId: 'wf-2', kind: 'fix' }));
    await runResumeCommand({ projectDir, list: true });
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('wf-1');
    expect(out).toContain('wf-2');
  });

  it('abandons a workflow and removes its scratch dir', async () => {
    const store = createStateStore({ projectDir });
    await store.save(state({ workflowId: 'wf-1' }));
    await runResumeCommand({ projectDir, abandon: 'wf-1' });
    expect(await store.load('wf-1')).toBeNull();
  });

  it('throws when --abandon target does not exist', async () => {
    await expect(runResumeCommand({ projectDir, abandon: 'no-such-wf' })).rejects.toThrow(
      /No workflow found/,
    );
  });

  it('reports a terminal-only set when there are no resumable workflows', async () => {
    const store = createStateStore({ projectDir });
    await store.save(state({ workflowId: 'wf-done', status: 'completed' }));
    await runResumeCommand({ projectDir });
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('No active workflows');
    expect(out).toContain('wf-done');
  });
});
