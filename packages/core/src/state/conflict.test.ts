import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildConflictReport, resolveConflicts } from './conflict.js';
import { snapshotFiles } from './snapshots.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spex-conflict-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('buildConflictReport', () => {
  it('returns hasConflicts=false when nothing changed', async () => {
    await writeFile(join(dir, 'a.txt'), 'same', 'utf8');
    const snaps = await snapshotFiles(dir, ['a.txt']);
    const report = await buildConflictReport(dir, {
      name: 'cp',
      createdAt: '2026-05-20T10:00:00.000Z',
      fileSnapshots: snaps,
    });
    expect(report.hasConflicts).toBe(false);
  });

  it('annotates each conflict with a human-friendly description', async () => {
    await writeFile(join(dir, 'a.txt'), 'old', 'utf8');
    const snaps = await snapshotFiles(dir, ['a.txt']);
    await writeFile(join(dir, 'a.txt'), 'new', 'utf8');
    const report = await buildConflictReport(dir, {
      name: 'cp',
      createdAt: '2026-05-20T10:00:00.000Z',
      fileSnapshots: snaps,
    });
    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts[0]?.description).toContain('content changed since checkpoint');
  });
});

describe('resolveConflicts', () => {
  it('returns the chosen resolution per file', async () => {
    await writeFile(join(dir, 'a.txt'), 'old', 'utf8');
    await writeFile(join(dir, 'b.txt'), 'old', 'utf8');
    const snaps = await snapshotFiles(dir, ['a.txt', 'b.txt']);
    await writeFile(join(dir, 'a.txt'), 'changed', 'utf8');
    await writeFile(join(dir, 'b.txt'), 'changed', 'utf8');
    const report = await buildConflictReport(dir, {
      name: 'cp',
      createdAt: '2026-05-20T10:00:00.000Z',
      fileSnapshots: snaps,
    });
    const choices: Record<string, 'keep_current' | 'restore_checkpoint'> = {
      'a.txt': 'keep_current',
      'b.txt': 'restore_checkpoint',
    };
    const { resolutions, aborted } = await resolveConflicts(
      report,
      async (c) => choices[c.path] ?? 'keep_current',
    );
    expect(aborted).toBe(false);
    expect(resolutions.get('a.txt')).toBe('keep_current');
    expect(resolutions.get('b.txt')).toBe('restore_checkpoint');
  });

  it('flags aborted=true on the first abort and stops asking', async () => {
    await writeFile(join(dir, 'a.txt'), 'old', 'utf8');
    await writeFile(join(dir, 'b.txt'), 'old', 'utf8');
    const snaps = await snapshotFiles(dir, ['a.txt', 'b.txt']);
    await writeFile(join(dir, 'a.txt'), 'changed', 'utf8');
    await writeFile(join(dir, 'b.txt'), 'changed', 'utf8');
    const report = await buildConflictReport(dir, {
      name: 'cp',
      createdAt: '2026-05-20T10:00:00.000Z',
      fileSnapshots: snaps,
    });
    let asked = 0;
    const { aborted, resolutions } = await resolveConflicts(report, async () => {
      asked++;
      return 'abort';
    });
    expect(aborted).toBe(true);
    expect(asked).toBe(1);
    expect(resolutions.size).toBe(1);
  });

  it('reprompts on diff', async () => {
    await writeFile(join(dir, 'a.txt'), 'old', 'utf8');
    const snaps = await snapshotFiles(dir, ['a.txt']);
    await writeFile(join(dir, 'a.txt'), 'changed', 'utf8');
    const report = await buildConflictReport(dir, {
      name: 'cp',
      createdAt: '2026-05-20T10:00:00.000Z',
      fileSnapshots: snaps,
    });
    const responses: ('diff' | 'keep_current')[] = ['diff', 'diff', 'keep_current'];
    let i = 0;
    const { resolutions } = await resolveConflicts(report, async () => responses[i++] ?? 'abort');
    expect(resolutions.get('a.txt')).toBe('keep_current');
    expect(i).toBe(3);
  });
});
