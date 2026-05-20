import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStateStore } from './persistence.js';
import { rollbackToCheckpoint } from './rollback.js';
import { snapshotFiles } from './snapshots.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spex-rollback-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('rollbackToCheckpoint', () => {
  it('removes files that the checkpoint records as absent', async () => {
    const store = createStateStore({ projectDir: dir });
    const snaps = await snapshotFiles(dir, ['will-be-added.txt']);
    await writeFile(join(dir, 'will-be-added.txt'), 'added later', 'utf8');
    const result = await rollbackToCheckpoint(store, 'wf-1', {
      name: 'cp',
      createdAt: '2026-05-20T10:00:00.000Z',
      fileSnapshots: snaps,
    });
    expect(result.removed).toEqual(['will-be-added.txt']);
    await expect(readFile(join(dir, 'will-be-added.txt'), 'utf8')).rejects.toThrow();
  });

  it('restores file content when source content is provided', async () => {
    const store = createStateStore({ projectDir: dir });
    await writeFile(join(dir, 'data.txt'), 'original', 'utf8');
    const snaps = await snapshotFiles(dir, ['data.txt']);
    await writeFile(join(dir, 'data.txt'), 'corrupted by a half-finished write', 'utf8');
    const fileContent = new Map([['data.txt', 'original']]);
    const result = await rollbackToCheckpoint(
      store,
      'wf-1',
      {
        name: 'cp',
        createdAt: '2026-05-20T10:00:00.000Z',
        fileSnapshots: snaps,
      },
      { fileContent },
    );
    expect(result.restored).toEqual(['data.txt']);
    expect(await readFile(join(dir, 'data.txt'), 'utf8')).toBe('original');
  });

  it('reports a failure when content is not available for an existing snapshot', async () => {
    const store = createStateStore({ projectDir: dir });
    await writeFile(join(dir, 'data.txt'), 'original', 'utf8');
    const snaps = await snapshotFiles(dir, ['data.txt']);
    const result = await rollbackToCheckpoint(store, 'wf-1', {
      name: 'cp',
      createdAt: '2026-05-20T10:00:00.000Z',
      fileSnapshots: snaps,
    });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).toContain('hash-only snapshot');
  });
});
