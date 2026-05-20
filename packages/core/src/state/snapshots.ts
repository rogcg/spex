import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { FileSnapshot } from '@spex/schemas';

export type DriftKind = 'modified' | 'deleted' | 'unexpected';

export interface FileDrift {
  path: string;
  kind: DriftKind;
  previousHash?: string;
  currentHash?: string;
}

/**
 * Capture a SHA-256 snapshot of each file. Paths are resolved relative to
 * `projectDir` and stored as project-relative POSIX-style paths so snapshots
 * survive being read on a different machine.
 */
export async function snapshotFiles(
  projectDir: string,
  paths: readonly string[],
): Promise<FileSnapshot[]> {
  const snapshots: FileSnapshot[] = [];
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : join(projectDir, p);
    const rel = toPosixRelative(projectDir, abs);
    try {
      const buf = await readFile(abs);
      const hash = createHash('sha256').update(buf).digest('hex');
      const info = await stat(abs);
      snapshots.push({ path: rel, hash, size: info.size, exists: true });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT') {
        snapshots.push({ path: rel, hash: '0'.repeat(64), size: 0, exists: false });
        continue;
      }
      throw error;
    }
  }
  return snapshots;
}

/**
 * Detect drift between `expected` (e.g. from a checkpoint) and the current
 * filesystem state. The result is a deterministic list ordered by path.
 */
export async function detectDrift(
  projectDir: string,
  expected: readonly FileSnapshot[],
): Promise<FileDrift[]> {
  const drifts: FileDrift[] = [];
  for (const snap of expected) {
    const abs = join(projectDir, snap.path);
    let currentHash: string | undefined;
    let currentExists = false;
    try {
      const buf = await readFile(abs);
      currentHash = createHash('sha256').update(buf).digest('hex');
      currentExists = true;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
    if (snap.exists && !currentExists) {
      drifts.push({ path: snap.path, kind: 'deleted', previousHash: snap.hash });
    } else if (!snap.exists && currentExists && currentHash) {
      drifts.push({ path: snap.path, kind: 'unexpected', currentHash });
    } else if (snap.exists && currentExists && currentHash && currentHash !== snap.hash) {
      drifts.push({
        path: snap.path,
        kind: 'modified',
        previousHash: snap.hash,
        currentHash,
      });
    }
  }
  drifts.sort((a, b) => a.path.localeCompare(b.path));
  return drifts;
}

function toPosixRelative(projectDir: string, abs: string): string {
  const rel = relative(projectDir, abs);
  return rel
    .split(/[\\/]+/)
    .filter(Boolean)
    .join('/');
}
