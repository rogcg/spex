import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname as osHostname } from 'node:os';
import { dirname } from 'node:path';
import { type ScratchLock, ScratchLockSchema } from '@spex/schemas';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { SpexError } from '../errors.js';

export class LockHeldError extends SpexError {
  readonly current: ScratchLock;
  constructor(current: ScratchLock) {
    super(
      `Workflow ${current.workflowId} is locked (pid=${current.pid}, host=${current.hostname}, acquiredAt=${current.acquiredAt})`,
    );
    this.current = current;
  }
}

export interface AcquireLockOptions {
  workflowId: string;
  lockPath: string;
  pid?: number;
  hostname?: string;
  now?: () => Date;
  /** Force-take the lock even when one is present. Use for crash recovery. */
  force?: boolean;
}

export async function acquireLock(opts: AcquireLockOptions): Promise<ScratchLock> {
  const existing = await readLock(opts.lockPath);
  if (existing && !opts.force) {
    throw new LockHeldError(existing);
  }
  const lock: ScratchLock = ScratchLockSchema.parse({
    version: 1,
    workflowId: opts.workflowId,
    pid: opts.pid ?? process.pid,
    hostname: opts.hostname ?? (osHostname() || 'unknown'),
    acquiredAt: (opts.now ?? (() => new Date()))().toISOString(),
  });
  await mkdir(dirname(opts.lockPath), { recursive: true });
  await writeFile(opts.lockPath, stringifyYaml(lock), 'utf8');
  return lock;
}

export async function releaseLock(lockPath: string): Promise<void> {
  await rm(lockPath, { force: true });
}

export async function readLock(lockPath: string): Promise<ScratchLock | null> {
  let raw: string;
  try {
    raw = await readFile(lockPath, 'utf8');
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new SpexError(`Could not parse lock file at ${lockPath}`, { cause: error });
  }
  const result = ScratchLockSchema.safeParse(parsed);
  if (!result.success) {
    throw new SpexError(`Invalid lock file at ${lockPath}: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Returns true when a process with `pid` is running on this host. Returns
 * `null` when the lock was acquired on a different host (we cannot tell).
 */
export function isProcessAlive(lock: ScratchLock): boolean | null {
  const localHost = osHostname() || 'unknown';
  if (lock.hostname && lock.hostname !== localHost) {
    return null;
  }
  try {
    // Signal 0 is a no-op that throws if the process does not exist.
    process.kill(lock.pid, 0);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'EPERM') {
      // Process exists but belongs to another user; treat as alive.
      return true;
    }
    return false;
  }
}
