import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Checkpoint,
  CheckpointSchema,
  type FileSnapshot,
  type ScratchSession,
  ScratchSessionSchema,
  type ScratchState,
  ScratchStateSchema,
  WORKFLOW_ID_PATTERN,
} from '@spex/schemas';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { SpexError } from '../errors.js';
import { atomicWriteFile } from './atomic.js';
import {
  type ScratchPaths,
  type WorkflowPaths,
  checkpointFile,
  resolveScratchPaths,
  resolveWorkflowPaths,
} from './paths.js';

export interface WorkflowSummary {
  workflowId: string;
  kind: ScratchState['kind'];
  status: ScratchState['status'];
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  description?: string;
  pid?: number;
  hostname?: string;
}

export interface StateStore {
  readonly paths: ScratchPaths;
  readonly projectDir: string;
  save(state: ScratchState): Promise<void>;
  load(workflowId: string): Promise<ScratchState | null>;
  list(): Promise<WorkflowSummary[]>;
  checkpoint(workflowId: string, checkpoint: Checkpoint): Promise<void>;
  loadCheckpoint(workflowId: string, name: string): Promise<Checkpoint | null>;
  listCheckpoints(workflowId: string): Promise<string[]>;
  delete(workflowId: string): Promise<void>;
  cleanup(olderThanDays: number, now?: () => Date): Promise<number>;
  readSession(): Promise<ScratchSession | null>;
  writeSession(session: ScratchSession): Promise<void>;
  workflowPaths(workflowId: string): WorkflowPaths;
}

export interface CreateStateStoreOptions {
  projectDir: string;
  scratchDir?: string;
}

export function createStateStore(opts: CreateStateStoreOptions): StateStore {
  const paths = resolveScratchPaths(opts.projectDir, opts.scratchDir);

  function pathsFor(workflowId: string): WorkflowPaths {
    if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
      throw new SpexError(`Invalid workflowId: ${workflowId}`);
    }
    return resolveWorkflowPaths(paths.root, workflowId);
  }

  return {
    paths,
    projectDir: opts.projectDir,
    workflowPaths: pathsFor,

    async save(state) {
      const validated = ScratchStateSchema.parse(state);
      const wp = pathsFor(validated.workflowId);
      await atomicWriteFile(wp.state, stringifyYaml(validated));
    },

    async load(workflowId) {
      const wp = pathsFor(workflowId);
      return readState(wp.state);
    },

    async list() {
      let entries: string[];
      try {
        entries = await readdir(paths.workflows);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'ENOENT') return [];
        throw error;
      }
      const summaries: WorkflowSummary[] = [];
      for (const entry of entries) {
        if (!WORKFLOW_ID_PATTERN.test(entry)) continue;
        const state = await readState(join(paths.workflows, entry, 'state.yaml'));
        if (!state) continue;
        summaries.push(toSummary(state));
      }
      summaries.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
      return summaries;
    },

    async checkpoint(workflowId, checkpoint) {
      const validated = CheckpointSchema.parse(checkpoint);
      const wp = pathsFor(workflowId);
      await mkdir(wp.checkpoints, { recursive: true });
      await atomicWriteFile(checkpointFile(wp.root, validated.name), stringifyYaml(validated));
    },

    async loadCheckpoint(workflowId, name) {
      const wp = pathsFor(workflowId);
      const path = checkpointFile(wp.root, name);
      let raw: string;
      try {
        raw = await readFile(path, 'utf8');
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'ENOENT') return null;
        throw error;
      }
      const parsed = parseYaml(raw);
      const result = CheckpointSchema.safeParse(parsed);
      if (!result.success) {
        throw new SpexError(`Invalid checkpoint at ${path}: ${result.error.message}`);
      }
      return result.data;
    },

    async listCheckpoints(workflowId) {
      const wp = pathsFor(workflowId);
      let entries: string[];
      try {
        entries = await readdir(wp.checkpoints);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'ENOENT') return [];
        throw error;
      }
      return entries
        .filter((f) => f.endsWith('.yaml'))
        .map((f) => f.slice(0, -'.yaml'.length))
        .sort();
    },

    async delete(workflowId) {
      const wp = pathsFor(workflowId);
      await rm(wp.root, { recursive: true, force: true });
    },

    async cleanup(olderThanDays, now = () => new Date()) {
      const cutoff = now().getTime() - olderThanDays * 24 * 60 * 60 * 1000;
      const summaries = await this.list();
      let removed = 0;
      for (const s of summaries) {
        if (s.status !== 'completed' && s.status !== 'abandoned') continue;
        const ts = Date.parse(s.lastActivityAt);
        if (!Number.isFinite(ts)) continue;
        if (ts < cutoff) {
          await this.delete(s.workflowId);
          removed++;
        }
      }
      return removed;
    },

    async readSession() {
      let raw: string;
      try {
        raw = await readFile(paths.session, 'utf8');
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'ENOENT') return null;
        throw error;
      }
      const parsed = parseYaml(raw);
      const result = ScratchSessionSchema.safeParse(parsed);
      if (!result.success) {
        throw new SpexError(`Invalid session file: ${result.error.message}`);
      }
      return result.data;
    },

    async writeSession(session) {
      const validated = ScratchSessionSchema.parse(session);
      await atomicWriteFile(paths.session, stringifyYaml(validated));
    },
  };
}

async function readState(path: string): Promise<ScratchState | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new SpexError(`Could not parse scratch state at ${path}`, { cause: error });
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    typeof (parsed as { version: unknown }).version === 'number' &&
    (parsed as { version: number }).version !== 1
  ) {
    throw new SpexError(
      `Unsupported scratch state version at ${path}: ${(parsed as { version: number }).version}`,
    );
  }
  const result = ScratchStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new SpexError(`Invalid scratch state at ${path}: ${result.error.message}`);
  }
  return result.data;
}

function toSummary(state: ScratchState): WorkflowSummary {
  const summary: WorkflowSummary = {
    workflowId: state.workflowId,
    kind: state.kind,
    status: state.status,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    lastActivityAt: state.lastActivityAt,
  };
  if (state.description !== undefined) summary.description = state.description;
  if (state.pid !== undefined) summary.pid = state.pid;
  if (state.hostname !== undefined) summary.hostname = state.hostname;
  return summary;
}

export type { ScratchPaths, WorkflowPaths };
