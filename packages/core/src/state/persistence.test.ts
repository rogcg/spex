import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScratchState } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStateStore } from './persistence.js';

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'spex-state-'));
});
afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

function makeState(workflowId: string, overrides: Partial<ScratchState> = {}): ScratchState {
  return {
    version: 1,
    workflowId,
    kind: 'implementation',
    status: 'running',
    createdAt: '2026-05-20T10:00:00.000Z',
    updatedAt: '2026-05-20T10:00:00.000Z',
    lastActivityAt: '2026-05-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('createStateStore', () => {
  it('round-trips state through save + load', async () => {
    const store = createStateStore({ projectDir });
    const state = makeState('wf-1', { payload: { step: 1 } });
    await store.save(state);

    const loaded = await store.load('wf-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.workflowId).toBe('wf-1');
    expect(loaded?.payload).toEqual({ step: 1 });
  });

  it('returns null when loading a missing workflow', async () => {
    const store = createStateStore({ projectDir });
    expect(await store.load('nope')).toBeNull();
  });

  it('writes state atomically (no .tmp left behind)', async () => {
    const store = createStateStore({ projectDir });
    await store.save(makeState('wf-1'));
    const wp = store.workflowPaths('wf-1');
    const dir = (await readFile(wp.state, 'utf8')).length > 0;
    expect(dir).toBe(true);
    // Ensure no .tmp shadow files left over
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(wp.root);
    expect(entries.some((f) => f.includes('.tmp'))).toBe(false);
  });

  it('lists workflows sorted by lastActivityAt desc', async () => {
    const store = createStateStore({ projectDir });
    await store.save(makeState('wf-old', { lastActivityAt: '2026-05-19T10:00:00.000Z' }));
    await store.save(makeState('wf-new', { lastActivityAt: '2026-05-20T11:00:00.000Z' }));
    const summaries = await store.list();
    expect(summaries.map((s) => s.workflowId)).toEqual(['wf-new', 'wf-old']);
  });

  it('rejects invalid workflowIds at the save boundary', async () => {
    const store = createStateStore({ projectDir });
    await expect(store.save(makeState('Has Space'))).rejects.toThrow();
  });

  it('saves and reads checkpoints', async () => {
    const store = createStateStore({ projectDir });
    await store.save(makeState('wf-1'));
    await store.checkpoint('wf-1', {
      name: 'after-plan',
      createdAt: '2026-05-20T11:00:00.000Z',
      payload: { lastStep: 3 },
      fileSnapshots: [],
    });
    const cp = await store.loadCheckpoint('wf-1', 'after-plan');
    expect(cp).not.toBeNull();
    expect(cp?.payload).toEqual({ lastStep: 3 });
    expect(await store.listCheckpoints('wf-1')).toEqual(['after-plan']);
  });

  it('cleanup() removes completed/abandoned workflows older than retention', async () => {
    const store = createStateStore({ projectDir });
    const old = '2026-05-01T10:00:00.000Z';
    const recent = '2026-05-20T10:00:00.000Z';
    await store.save(
      makeState('done-old', { status: 'completed', lastActivityAt: old, updatedAt: old }),
    );
    await store.save(makeState('done-recent', { status: 'completed', lastActivityAt: recent }));
    await store.save(
      makeState('running-old', { status: 'running', lastActivityAt: old, updatedAt: old }),
    );
    const removed = await store.cleanup(7, () => new Date('2026-05-20T10:00:00.000Z'));
    expect(removed).toBe(1);
    const remaining = (await store.list()).map((s) => s.workflowId).sort();
    expect(remaining).toEqual(['done-recent', 'running-old']);
  });

  it('rejects an unknown version in the state file', async () => {
    const store = createStateStore({ projectDir });
    const wp = store.workflowPaths('wf-1');
    // Manually write a v2 file
    const { mkdir } = await import('node:fs/promises');
    await mkdir(wp.root, { recursive: true });
    await writeFile(wp.state, 'version: 2\nworkflowId: wf-1\n', 'utf8');
    await expect(store.load('wf-1')).rejects.toThrow(/Unsupported scratch state version/);
  });

  it('session round-trip', async () => {
    const store = createStateStore({ projectDir });
    expect(await store.readSession()).toBeNull();
    await store.writeSession({
      version: 1,
      activeWorkflowId: 'wf-1',
      updatedAt: '2026-05-20T10:00:00.000Z',
    });
    const session = await store.readSession();
    expect(session?.activeWorkflowId).toBe('wf-1');
  });
});
