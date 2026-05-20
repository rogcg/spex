import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LockHeldError, acquireLock, isProcessAlive, readLock, releaseLock } from './locks.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spex-lock-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('acquireLock', () => {
  it('writes a YAML lock file with PID and host', async () => {
    const lockPath = join(dir, 'lock');
    const lock = await acquireLock({ workflowId: 'wf-1', lockPath });
    expect(lock.workflowId).toBe('wf-1');
    expect(lock.pid).toBe(process.pid);
    const raw = await readFile(lockPath, 'utf8');
    expect(raw).toContain('workflowId: wf-1');
  });

  it('throws LockHeldError when a lock is already present', async () => {
    const lockPath = join(dir, 'lock');
    await acquireLock({ workflowId: 'wf-1', lockPath });
    await expect(acquireLock({ workflowId: 'wf-1', lockPath })).rejects.toBeInstanceOf(
      LockHeldError,
    );
  });

  it('force=true overwrites an existing lock (crash recovery)', async () => {
    const lockPath = join(dir, 'lock');
    await acquireLock({ workflowId: 'wf-1', lockPath, pid: 99999 });
    const reacquired = await acquireLock({
      workflowId: 'wf-1',
      lockPath,
      force: true,
    });
    expect(reacquired.pid).toBe(process.pid);
  });
});

describe('releaseLock', () => {
  it('removes the lock file', async () => {
    const lockPath = join(dir, 'lock');
    await acquireLock({ workflowId: 'wf-1', lockPath });
    await releaseLock(lockPath);
    expect(await readLock(lockPath)).toBeNull();
  });

  it('is a no-op when the lock is missing', async () => {
    await releaseLock(join(dir, 'lock'));
  });
});

describe('readLock', () => {
  it('returns null when the file does not exist', async () => {
    expect(await readLock(join(dir, 'nope'))).toBeNull();
  });
  it('throws on an unparseable file', async () => {
    const lockPath = join(dir, 'lock');
    await writeFile(lockPath, '{ not yaml: [', 'utf8');
    await expect(readLock(lockPath)).rejects.toThrow();
  });
});

describe('isProcessAlive', () => {
  it('returns true for our own PID', () => {
    expect(
      isProcessAlive({
        version: 1,
        workflowId: 'wf-1',
        pid: process.pid,
        hostname: require('node:os').hostname() || 'unknown',
        acquiredAt: '2026-05-20T10:00:00.000Z',
      }),
    ).toBe(true);
  });
  it('returns null for a different host (cannot tell)', () => {
    expect(
      isProcessAlive({
        version: 1,
        workflowId: 'wf-1',
        pid: 1,
        hostname: 'not-this-host-xyz',
        acquiredAt: '2026-05-20T10:00:00.000Z',
      }),
    ).toBeNull();
  });
});
