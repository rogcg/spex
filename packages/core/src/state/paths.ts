import { join } from 'node:path';

/** Default location for scratch state, relative to the project root. */
export const DEFAULT_SCRATCH_RELATIVE = join('.ai', 'scratch');

/** Default location for the audit log directory, relative to the project root. */
export const DEFAULT_AUDIT_RELATIVE = join('.ai', 'audit');

export interface ScratchPaths {
  root: string;
  workflows: string;
  session: string;
  lock: string;
}

export function resolveScratchPaths(projectDir: string, scratchDir?: string): ScratchPaths {
  const root = scratchDir ?? join(projectDir, DEFAULT_SCRATCH_RELATIVE);
  return {
    root,
    workflows: join(root, 'workflows'),
    session: join(root, 'session.yaml'),
    lock: join(root, 'lock'),
  };
}

export interface WorkflowPaths {
  root: string;
  state: string;
  checkpoints: string;
  lock: string;
}

export function resolveWorkflowPaths(scratchRoot: string, workflowId: string): WorkflowPaths {
  const root = join(scratchRoot, 'workflows', workflowId);
  return {
    root,
    state: join(root, 'state.yaml'),
    checkpoints: join(root, 'checkpoints'),
    lock: join(root, 'lock'),
  };
}

export function checkpointFile(workflowRoot: string, name: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(name)) {
    throw new Error(`Invalid checkpoint name "${name}"`);
  }
  return join(workflowRoot, 'checkpoints', `${name}.yaml`);
}
