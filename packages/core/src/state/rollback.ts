import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Checkpoint } from '@spex/schemas';
import type { StateStore } from './persistence.js';

export interface RollbackResult {
  restored: string[];
  removed: string[];
  failures: { path: string; reason: string }[];
}

export interface RollbackOptions {
  /**
   * When provided, file content is sourced from this map (path → content)
   * instead of being re-read. Used by tests and by callers that captured the
   * file content alongside the snapshot in `payload`.
   */
  fileContent?: Map<string, string>;
}

/**
 * Rollback the project's filesystem to match the file snapshots recorded in
 * `checkpoint`. The current implementation supports:
 *
 * - Removing files that the checkpoint records as "did not exist".
 * - Restoring file content when `opts.fileContent` provides it.
 *
 * Restoring content from the snapshot hash alone is not possible — hashes are
 * one-way. Callers that need byte-level restoration must either keep the
 * content in `payload` or use git.
 */
export async function rollbackToCheckpoint(
  store: StateStore,
  workflowId: string,
  checkpoint: Checkpoint,
  opts: RollbackOptions = {},
): Promise<RollbackResult> {
  const result: RollbackResult = { restored: [], removed: [], failures: [] };
  for (const snap of checkpoint.fileSnapshots) {
    const abs = join(store.projectDir, snap.path);
    if (!snap.exists) {
      try {
        await rm(abs, { force: true });
        result.removed.push(snap.path);
      } catch (error) {
        result.failures.push({
          path: snap.path,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }
    const content = opts.fileContent?.get(snap.path);
    if (content === undefined) {
      // We cannot reconstruct file contents from a SHA-256 hash. Surface this
      // explicitly so the caller can decide between asking the user or aborting.
      result.failures.push({
        path: snap.path,
        reason: 'no source content available to restore (hash-only snapshot)',
      });
      continue;
    }
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
      result.restored.push(snap.path);
    } catch (error) {
      result.failures.push({
        path: snap.path,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
