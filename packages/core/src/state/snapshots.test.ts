import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectDrift, snapshotFiles } from './snapshots.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spex-snap-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('snapshotFiles', () => {
  it('hashes existing files and reports non-existent ones', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello world', 'utf8');
    const snaps = await snapshotFiles(dir, ['a.txt', 'missing.txt']);
    expect(snaps).toHaveLength(2);
    expect(snaps[0]).toMatchObject({
      path: 'a.txt',
      exists: true,
      size: 'hello world'.length,
    });
    expect(snaps[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snaps[1]).toMatchObject({ path: 'missing.txt', exists: false, size: 0 });
  });
});

describe('detectDrift', () => {
  it('reports modified, deleted, and unexpected files', async () => {
    await writeFile(join(dir, 'mod.txt'), 'original', 'utf8');
    await writeFile(join(dir, 'gone.txt'), 'soon', 'utf8');
    const initial = await snapshotFiles(dir, ['mod.txt', 'gone.txt', 'absent.txt']);
    // Mutate state
    await writeFile(join(dir, 'mod.txt'), 'changed', 'utf8');
    await rm(join(dir, 'gone.txt'));
    await writeFile(join(dir, 'absent.txt'), 'now here', 'utf8');

    const drifts = await detectDrift(dir, initial);
    expect(drifts.map((d) => `${d.path}:${d.kind}`).sort()).toEqual([
      'absent.txt:unexpected',
      'gone.txt:deleted',
      'mod.txt:modified',
    ]);
  });

  it('returns no drift when filesystem is unchanged', async () => {
    await writeFile(join(dir, 'a.txt'), 'same', 'utf8');
    const snaps = await snapshotFiles(dir, ['a.txt']);
    const drifts = await detectDrift(dir, snaps);
    expect(drifts).toEqual([]);
  });
});
