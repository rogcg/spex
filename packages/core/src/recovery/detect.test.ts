import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScratchState } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock } from '../state/locks.js';
import { createStateStore } from '../state/persistence.js';
import { snapshotFiles } from '../state/snapshots.js';
import { detectCrashedWorkflows } from './detect.js';

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'spex-recovery-'));
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

describe('detectCrashedWorkflows', () => {
  it('flags running workflows with no live PID as interrupted', async () => {
    const store = createStateStore({ projectDir });
    await store.save(makeState('wf-1'));
    const candidates = await detectCrashedWorkflows(store, { isAlive: () => false });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.classification).toBe('interrupted');
    expect(candidates[0]?.resumable).toBe(true);
  });

  it('skips running workflows whose PID is still alive', async () => {
    const store = createStateStore({ projectDir });
    await store.save(makeState('wf-1'));
    const wp = store.workflowPaths('wf-1');
    await acquireLock({ workflowId: 'wf-1', lockPath: wp.lock });
    const candidates = await detectCrashedWorkflows(store, { isAlive: () => true });
    expect(candidates).toHaveLength(0);
  });

  it('classifies paused workflows as clean', async () => {
    const store = createStateStore({ projectDir });
    await store.save(makeState('wf-1', { status: 'paused' }));
    const candidates = await detectCrashedWorkflows(store);
    expect(candidates[0]?.classification).toBe('clean');
    expect(candidates[0]?.resumable).toBe(true);
  });

  it('ignores completed and abandoned workflows', async () => {
    const store = createStateStore({ projectDir });
    await store.save(makeState('wf-done', { status: 'completed' }));
    await store.save(makeState('wf-gone', { status: 'abandoned' }));
    const candidates = await detectCrashedWorkflows(store);
    expect(candidates).toHaveLength(0);
  });

  it('detects partial writes via checkpoint hash drift', async () => {
    const store = createStateStore({ projectDir });
    await store.save(makeState('wf-1'));
    await writeFile(join(projectDir, 'data.txt'), 'pre-crash', 'utf8');
    const snaps = await snapshotFiles(projectDir, ['data.txt']);
    await store.checkpoint('wf-1', {
      name: 'after-prepare',
      createdAt: '2026-05-20T10:00:00.000Z',
      fileSnapshots: snaps,
    });
    // Simulate a half-finished write.
    await writeFile(join(projectDir, 'data.txt'), 'partial-write-was-here', 'utf8');
    const candidates = await detectCrashedWorkflows(store, { isAlive: () => false });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.classification).toBe('partial_write');
    expect(candidates[0]?.driftPaths).toContain('data.txt');
    expect(candidates[0]?.resumable).toBe(false);
  });

  it('handles foreign-host locks conservatively', async () => {
    const store = createStateStore({ projectDir });
    await store.save(makeState('wf-1'));
    const wp = store.workflowPaths('wf-1');
    await acquireLock({
      workflowId: 'wf-1',
      lockPath: wp.lock,
      pid: 1,
      hostname: 'a-different-host-xyz',
    });
    const candidates = await detectCrashedWorkflows(store, { isAlive: () => null });
    expect(candidates[0]?.classification).toBe('foreign_host');
    expect(candidates[0]?.resumable).toBe(false);
  });
});
