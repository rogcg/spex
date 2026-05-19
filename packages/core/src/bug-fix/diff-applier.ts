import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { applyPatch, parsePatch } from 'diff';
import { SpexError } from '../errors.js';
import { resolveInsideProject } from '../implementation/safety.js';

export class FixDiffApplyError extends SpexError {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`Failed to apply fix to ${path}: ${message}`);
    this.path = path;
  }
}

export interface FixFileSnapshot {
  /** Project-relative path */
  path: string;
  /** Absolute path */
  absolutePath: string;
  existedBefore: boolean;
  contentBefore: string | null;
  contentAfter: string;
}

export interface ApplyFixDiffResult {
  /** Project-relative paths touched by the fix. Order matches application order. */
  affectedPaths: string[];
  /** Per-file snapshots, suitable for `revertFixDiff`. */
  snapshots: FixFileSnapshot[];
}

/**
 * Apply a unified-diff fix (typically produced by the fix-proposal generator)
 * to the filesystem under `projectDir`. Each touched file is snapshotted so the
 * caller can revert via {@link revertFixDiff}.
 *
 * The diff format supported is what the `diff` npm package's `parsePatch`
 * understands — standard unified diff with `---`/`+++`/`@@` headers, multiple
 * file hunks accepted in a single string.
 *
 * Path safety: every file referenced by the diff is run through
 * `resolveInsideProject`, so paths that escape the project root are rejected
 * before any I/O.
 */
export async function applyFixDiff(projectDir: string, diff: string): Promise<ApplyFixDiffResult> {
  const patches = parsePatch(diff);
  if (patches.length === 0) {
    throw new FixDiffApplyError('<no file>', 'unified diff contains no patches');
  }

  const snapshots: FixFileSnapshot[] = [];
  const applied: FixFileSnapshot[] = [];

  try {
    for (const patch of patches) {
      const targetPath = pickPath(patch);
      if (!targetPath) {
        throw new FixDiffApplyError('<unknown>', 'patch is missing both old and new file paths');
      }
      const absolutePath = resolveInsideProject(projectDir, targetPath);
      const snapshot = await readSnapshot(targetPath, absolutePath);

      const baseContent = snapshot.contentBefore ?? '';
      const patched = applyPatch(baseContent, patch);
      if (patched === false) {
        throw new FixDiffApplyError(
          targetPath,
          'patch did not apply cleanly to the current file contents',
        );
      }

      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, patched, 'utf8');

      const applied_: FixFileSnapshot = { ...snapshot, contentAfter: patched };
      snapshots.push(applied_);
      applied.push(applied_);
    }
  } catch (cause) {
    // Atomic: roll back anything we touched so the project is unchanged.
    await revertFixDiff(applied);
    throw cause;
  }

  return {
    affectedPaths: snapshots.map((s) => s.path),
    snapshots,
  };
}

/**
 * Revert files to their pre-fix state. Files that did not exist before the
 * fix are removed. Best-effort: continues through individual file errors.
 */
export async function revertFixDiff(snapshots: readonly FixFileSnapshot[]): Promise<void> {
  // Restore in reverse application order in case the apply step created
  // directories that later snapshots also rely on.
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const snapshot = snapshots[i];
    if (!snapshot) continue;
    try {
      if (snapshot.existedBefore && snapshot.contentBefore !== null) {
        await writeFile(snapshot.absolutePath, snapshot.contentBefore, 'utf8');
      } else {
        await rm(snapshot.absolutePath, { force: true });
      }
    } catch {
      // Best-effort: keep going.
    }
  }
}

function pickPath(patch: {
  oldFileName?: string | undefined;
  newFileName?: string | undefined;
}): string | null {
  const candidates = [patch.newFileName, patch.oldFileName];
  for (const raw of candidates) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    if (raw === '/dev/null') continue;
    return stripDiffPrefix(raw);
  }
  return null;
}

/** Strip the conventional `a/` or `b/` prefix from a unified-diff filename. */
function stripDiffPrefix(name: string): string {
  if (name.startsWith('a/') || name.startsWith('b/')) return name.slice(2);
  return name;
}

async function readSnapshot(
  path: string,
  absolutePath: string,
): Promise<Omit<FixFileSnapshot, 'contentAfter'>> {
  try {
    const s = await stat(absolutePath);
    if (!s.isFile()) {
      return { path, absolutePath, existedBefore: false, contentBefore: null };
    }
    return {
      path,
      absolutePath,
      existedBefore: true,
      contentBefore: await readFile(absolutePath, 'utf8'),
    };
  } catch {
    return { path, absolutePath, existedBefore: false, contentBefore: null };
  }
}
