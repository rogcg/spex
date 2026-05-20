import type { Checkpoint } from '@spex/schemas';
import { type FileDrift, detectDrift } from './snapshots.js';

export type ConflictResolution = 'keep_current' | 'restore_checkpoint' | 'diff' | 'abort';

export interface FileConflict extends FileDrift {
  /** Human-friendly description of the drift, suitable for CLI display. */
  description: string;
}

export interface ConflictReport {
  conflicts: FileConflict[];
  hasConflicts: boolean;
}

/**
 * Compare the project's current filesystem state with the snapshots recorded
 * in `checkpoint` and produce a per-file conflict report.
 *
 * Three classes are surfaced:
 *
 * - `modified`   — file present, content hash differs from the checkpoint
 * - `deleted`    — file recorded by the checkpoint is missing from disk
 * - `unexpected` — file exists on disk that the checkpoint recorded as absent
 */
export async function buildConflictReport(
  projectDir: string,
  checkpoint: Checkpoint,
): Promise<ConflictReport> {
  const drifts = await detectDrift(projectDir, checkpoint.fileSnapshots);
  const conflicts: FileConflict[] = drifts.map((d) => ({
    ...d,
    description: describeDrift(d),
  }));
  return { conflicts, hasConflicts: conflicts.length > 0 };
}

function describeDrift(d: FileDrift): string {
  switch (d.kind) {
    case 'modified':
      return `${d.path}: content changed since checkpoint (was ${shortHash(d.previousHash)}, now ${shortHash(d.currentHash)})`;
    case 'deleted':
      return `${d.path}: deleted since checkpoint`;
    case 'unexpected':
      return `${d.path}: appeared since checkpoint`;
  }
}

function shortHash(hash: string | undefined): string {
  if (!hash) return '<unknown>';
  return hash.slice(0, 12);
}

export type ConflictPrompter = (conflict: FileConflict) => Promise<ConflictResolution>;

export interface ResolveConflictsResult {
  resolutions: Map<string, ConflictResolution>;
  aborted: boolean;
}

/**
 * Walk each conflict and ask the prompter what to do. Returns the chosen
 * resolution per file and a flag that's true if the user chose `abort` for
 * any file. The function does NOT mutate the filesystem — the caller decides
 * what to do with the resolutions.
 */
export async function resolveConflicts(
  report: ConflictReport,
  prompter: ConflictPrompter,
): Promise<ResolveConflictsResult> {
  const resolutions = new Map<string, ConflictResolution>();
  for (const conflict of report.conflicts) {
    let choice = await prompter(conflict);
    // Keep reprompting on 'diff' — that's an inspection action, not a resolution.
    while (choice === 'diff') {
      choice = await prompter(conflict);
    }
    resolutions.set(conflict.path, choice);
    if (choice === 'abort') {
      return { resolutions, aborted: true };
    }
  }
  return { resolutions, aborted: false };
}
