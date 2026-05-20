import type { ScratchLock, ScratchState } from '@spex/schemas';
import { isProcessAlive, readLock } from '../state/locks.js';
import type { StateStore } from '../state/persistence.js';
import { detectDrift } from '../state/snapshots.js';

export type CrashClassification = 'clean' | 'interrupted' | 'partial_write' | 'foreign_host';

export interface CrashCandidate {
  workflowId: string;
  state: ScratchState;
  lock: ScratchLock | null;
  classification: CrashClassification;
  /** True when the workflow can be safely resumed (no rollback required). */
  resumable: boolean;
  /** Drifted paths detected vs the most-recent checkpoint, when any. */
  driftPaths: readonly string[];
  /** Name of the checkpoint compared against, when one exists. */
  comparedCheckpoint: string | null;
}

export interface DetectCrashedWorkflowsOptions {
  /** Test hook — override `isProcessAlive` for deterministic behavior. */
  isAlive?: (lock: ScratchLock) => boolean | null;
}

/**
 * Scan the scratch directory for workflows that were left in `running` state
 * without an active process behind them, and classify each.
 *
 * - `clean`        — `paused` workflows; no recovery action required.
 * - `interrupted`  — `running` state but no active PID (SIGKILL, crash).
 * - `partial_write`— `interrupted` AND drift detected against the last checkpoint.
 * - `foreign_host` — lock acquired on a different host; we cannot tell PID status.
 */
export async function detectCrashedWorkflows(
  store: StateStore,
  opts: DetectCrashedWorkflowsOptions = {},
): Promise<CrashCandidate[]> {
  const aliveCheck = opts.isAlive ?? isProcessAlive;
  const summaries = await store.list();
  const candidates: CrashCandidate[] = [];
  for (const summary of summaries) {
    const state = await store.load(summary.workflowId);
    if (!state) continue;
    if (state.status === 'completed' || state.status === 'abandoned') continue;

    const wp = store.workflowPaths(state.workflowId);
    const lock = await readLock(wp.lock);

    if (state.status === 'paused') {
      candidates.push({
        workflowId: state.workflowId,
        state,
        lock,
        classification: 'clean',
        resumable: true,
        driftPaths: [],
        comparedCheckpoint: null,
      });
      continue;
    }

    if (state.status === 'running' || state.status === 'crashed') {
      // Determine liveness. With no lock at all we treat the workflow as
      // orphaned (the process never wrote a lock or already released it).
      const alive: boolean | null = lock ? aliveCheck(lock) : false;
      if (alive === true) {
        // Still alive — nothing to recover here.
        continue;
      }
      if (alive === null) {
        candidates.push({
          workflowId: state.workflowId,
          state,
          lock,
          classification: 'foreign_host',
          resumable: false,
          driftPaths: [],
          comparedCheckpoint: null,
        });
        continue;
      }
      // Process is gone. Compare against most-recent checkpoint to detect partial writes.
      const checkpoints = await store.listCheckpoints(state.workflowId);
      let driftPaths: string[] = [];
      let comparedCheckpoint: string | null = null;
      if (checkpoints.length > 0) {
        const latestName = checkpoints[checkpoints.length - 1] as string;
        const checkpoint = await store.loadCheckpoint(state.workflowId, latestName);
        if (checkpoint && checkpoint.fileSnapshots.length > 0) {
          const drifts = await detectDrift(store.projectDir, checkpoint.fileSnapshots);
          driftPaths = drifts.map((d) => d.path);
          comparedCheckpoint = latestName;
        }
      }
      candidates.push({
        workflowId: state.workflowId,
        state,
        lock,
        classification: driftPaths.length > 0 ? 'partial_write' : 'interrupted',
        resumable: driftPaths.length === 0,
        driftPaths,
        comparedCheckpoint,
      });
    }
  }
  return candidates;
}
