export {
  DEFAULT_AUDIT_RELATIVE,
  DEFAULT_SCRATCH_RELATIVE,
  checkpointFile,
  resolveScratchPaths,
  resolveWorkflowPaths,
  type ScratchPaths,
  type WorkflowPaths,
} from './paths.js';
export { atomicWriteFile } from './atomic.js';
export {
  LockHeldError,
  acquireLock,
  isProcessAlive,
  readLock,
  releaseLock,
  type AcquireLockOptions,
} from './locks.js';
export {
  createStateStore,
  type CreateStateStoreOptions,
  type StateStore,
  type WorkflowSummary,
} from './persistence.js';
export {
  detectDrift,
  snapshotFiles,
  type FileDrift,
  type DriftKind,
} from './snapshots.js';
export {
  rollbackToCheckpoint,
  type RollbackOptions,
  type RollbackResult,
} from './rollback.js';
export {
  buildConflictReport,
  resolveConflicts,
  type ConflictPrompter,
  type ConflictReport,
  type ConflictResolution,
  type FileConflict,
  type ResolveConflictsResult,
} from './conflict.js';
