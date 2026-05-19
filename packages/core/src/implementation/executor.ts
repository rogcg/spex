import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ImplementationPlan, PlanOperation } from '@spex/schemas';
import { applyPatch } from 'diff';
import { SpexError } from '../errors.js';
import { type AuditLog, type AuditRecord, openAuditLog } from './audit.js';
import { resolveInsideProject } from './safety.js';

export type ExecutorMode = 'dry-run' | 'auto' | 'step-by-step';

export type PlannedOperationKind = 'create' | 'modify' | 'delete' | 'test-create';

export interface PlannedOperation {
  order: number;
  kind: PlannedOperationKind;
  path: string;
  rationale: string;
  full_content?: string;
  diff?: string;
}

export interface ExecutorOptions {
  projectDir: string;
  plan: ImplementationPlan;
  mode: ExecutorMode;
  /**
   * Required when `mode === 'step-by-step'`. Called before each operation.
   * Return true to apply, false to skip. Throwing aborts the whole run.
   */
  onBeforeOperation?: (op: PlannedOperation) => Promise<boolean>;
  /** Date factory for deterministic timestamps in tests. */
  now?: () => Date;
  /** Override the audit directory. Defaults to `<projectDir>/.ai/audit`. */
  auditDir?: string;
}

export interface ExecutorResult {
  dryRun: boolean;
  applied: PlannedOperation[];
  skipped: PlannedOperation[];
  rolledBack: PlannedOperation[];
  auditLogPath: string | null;
}

export class ExecutionAbortedError extends SpexError {
  readonly applied: readonly PlannedOperation[];
  readonly failed: PlannedOperation;
  readonly rolledBack: readonly PlannedOperation[];
  readonly auditLogPath: string | null;

  constructor(opts: {
    failed: PlannedOperation;
    cause: unknown;
    applied: readonly PlannedOperation[];
    rolledBack: readonly PlannedOperation[];
    auditLogPath: string | null;
  }) {
    super(
      `Execution aborted at operation #${opts.failed.order} (${opts.failed.kind} ${opts.failed.path}): ${formatCause(opts.cause)}`,
      { cause: opts.cause },
    );
    this.applied = opts.applied;
    this.failed = opts.failed;
    this.rolledBack = opts.rolledBack;
    this.auditLogPath = opts.auditLogPath;
  }
}

export class DiffApplyError extends SpexError {
  readonly path: string;
  constructor(path: string) {
    super(`Failed to apply diff to ${path}: patch did not apply cleanly.`);
    this.path = path;
  }
}

interface AppliedSnapshot {
  op: PlannedOperation;
  absolutePath: string;
  existedBefore: boolean;
  contentBefore: string | null;
}

export async function executePlan(options: ExecutorOptions): Promise<ExecutorResult> {
  const operations = buildOperationList(options.plan);
  const resolved = operations.map((op) => ({
    op,
    absolutePath: resolveInsideProject(options.projectDir, op.path),
  }));

  if (options.mode === 'step-by-step' && !options.onBeforeOperation) {
    throw new SpexError(
      "ExecutorOptions.onBeforeOperation is required when mode === 'step-by-step'.",
    );
  }

  if (options.mode === 'dry-run') {
    return {
      dryRun: true,
      applied: operations,
      skipped: [],
      rolledBack: [],
      auditLogPath: null,
    };
  }

  const now = options.now ?? (() => new Date());
  const auditLog = await openAuditLog({
    projectDir: options.projectDir,
    featureSlug: options.plan.feature_slug,
    ...(options.now ? { now: options.now } : {}),
    ...(options.auditDir !== undefined ? { auditDir: options.auditDir } : {}),
  });

  await auditLog.append({
    type: 'run-start',
    timestamp: now().toISOString(),
    feature_slug: options.plan.feature_slug,
    mode: options.mode,
    operation_count: operations.length,
  });

  const applied: AppliedSnapshot[] = [];
  const skipped: PlannedOperation[] = [];

  const confirm = options.onBeforeOperation;
  for (const { op, absolutePath } of resolved) {
    if (options.mode === 'step-by-step' && confirm) {
      const proceed = await confirm(op);
      if (!proceed) {
        skipped.push(op);
        await auditLog.append({
          type: 'op',
          timestamp: now().toISOString(),
          order: op.order,
          path: op.path,
          operation: op.kind,
          outcome: 'skipped',
        });
        continue;
      }
    }

    try {
      const snapshot = await applyOperation(absolutePath, op);
      applied.push(snapshot);
      await auditLog.append({
        type: 'op',
        timestamp: now().toISOString(),
        order: op.order,
        path: op.path,
        operation: op.kind,
        outcome: 'applied',
      });
    } catch (cause) {
      await auditLog.append({
        type: 'op',
        timestamp: now().toISOString(),
        order: op.order,
        path: op.path,
        operation: op.kind,
        outcome: 'failed',
        error: formatCause(cause),
      });
      const rolledBack = await rollback(applied, auditLog, now);
      await auditLog.append({
        type: 'run-end',
        timestamp: now().toISOString(),
        outcome: 'failure',
        applied_count: 0,
        skipped_count: skipped.length,
        rolled_back_count: rolledBack.length,
        error: formatCause(cause),
      });
      throw new ExecutionAbortedError({
        failed: op,
        cause,
        applied: applied.map((s) => s.op),
        rolledBack,
        auditLogPath: auditLog.path,
      });
    }
  }

  await auditLog.append({
    type: 'run-end',
    timestamp: now().toISOString(),
    outcome: 'success',
    applied_count: applied.length,
    skipped_count: skipped.length,
    rolled_back_count: 0,
  });

  return {
    dryRun: false,
    applied: applied.map((s) => s.op),
    skipped,
    rolledBack: [],
    auditLogPath: auditLog.path,
  };
}

function buildOperationList(plan: ImplementationPlan): PlannedOperation[] {
  const main: PlannedOperation[] = plan.operations
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((op) => toPlannedOperation(op));
  const baseOrder = main.length;
  const tests: PlannedOperation[] = plan.tests_to_add.map((test, index) => ({
    order: baseOrder + index + 1,
    kind: 'test-create',
    path: test.path,
    rationale: 'Test file from plan.tests_to_add',
    full_content: test.content,
  }));
  return [...main, ...tests];
}

function toPlannedOperation(op: PlanOperation): PlannedOperation {
  switch (op.operation) {
    case 'create':
      return {
        order: op.order,
        kind: 'create',
        path: op.path,
        rationale: op.rationale,
        full_content: op.full_content,
      };
    case 'modify': {
      const planned: PlannedOperation = {
        order: op.order,
        kind: 'modify',
        path: op.path,
        rationale: op.rationale,
      };
      if (op.diff !== undefined) {
        planned.diff = op.diff;
      }
      if (op.full_content !== undefined) {
        planned.full_content = op.full_content;
      }
      return planned;
    }
    case 'delete':
      return {
        order: op.order,
        kind: 'delete',
        path: op.path,
        rationale: op.rationale,
      };
  }
}

async function applyOperation(
  absolutePath: string,
  op: PlannedOperation,
): Promise<AppliedSnapshot> {
  const snapshot = await snapshotFile(absolutePath, op);

  switch (op.kind) {
    case 'create':
    case 'test-create': {
      if (snapshot.existedBefore) {
        throw new SpexError(
          `Cannot create ${op.path}: file already exists. Refusing to overwrite without an explicit 'modify' operation.`,
        );
      }
      if (op.full_content === undefined) {
        throw new SpexError(`Cannot create ${op.path}: plan operation is missing full_content.`);
      }
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, op.full_content, 'utf8');
      return snapshot;
    }
    case 'modify': {
      if (!snapshot.existedBefore || snapshot.contentBefore === null) {
        throw new SpexError(
          `Cannot modify ${op.path}: file does not exist. Use a 'create' operation instead.`,
        );
      }
      const nextContent = computeModifiedContent(op, snapshot.contentBefore);
      await writeFile(absolutePath, nextContent, 'utf8');
      return snapshot;
    }
    case 'delete': {
      if (!snapshot.existedBefore) {
        throw new SpexError(`Cannot delete ${op.path}: file does not exist.`);
      }
      await rm(absolutePath, { force: false });
      return snapshot;
    }
  }
}

function computeModifiedContent(op: PlannedOperation, currentContent: string): string {
  if (op.full_content !== undefined) {
    return op.full_content;
  }
  if (op.diff === undefined) {
    throw new SpexError(
      `Cannot modify ${op.path}: plan operation is missing both diff and full_content.`,
    );
  }
  const patched = applyPatch(currentContent, op.diff);
  if (patched === false) {
    throw new DiffApplyError(op.path);
  }
  return patched;
}

async function snapshotFile(absolutePath: string, op: PlannedOperation): Promise<AppliedSnapshot> {
  let existedBefore = false;
  let contentBefore: string | null = null;
  try {
    const s = await stat(absolutePath);
    if (!s.isFile()) {
      throw new SpexError(`Path ${op.path} exists but is not a regular file.`);
    }
    existedBefore = true;
    contentBefore = await readFile(absolutePath, 'utf8');
  } catch (error) {
    if (error instanceof SpexError) throw error;
    // ENOENT is expected for create / test-create. Other errors are also benign here:
    // the subsequent applyOperation step will fail loudly if the path is unreachable.
  }
  return { op, absolutePath, existedBefore, contentBefore };
}

async function rollback(
  applied: readonly AppliedSnapshot[],
  auditLog: AuditLog,
  now: () => Date,
): Promise<PlannedOperation[]> {
  const reverted: PlannedOperation[] = [];
  for (let i = applied.length - 1; i >= 0; i -= 1) {
    const snapshot = applied[i];
    if (!snapshot) {
      continue;
    }
    const auditAction: 'restore' | 'delete' = snapshot.existedBefore ? 'restore' : 'delete';
    try {
      if (snapshot.existedBefore && snapshot.contentBefore !== null) {
        await writeFile(snapshot.absolutePath, snapshot.contentBefore, 'utf8');
      } else {
        await rm(snapshot.absolutePath, { force: true });
      }
      reverted.push(snapshot.op);
      const entry: AuditRecord = {
        type: 'rollback',
        timestamp: now().toISOString(),
        order: snapshot.op.order,
        path: snapshot.op.path,
        action: auditAction,
      };
      await auditLog.append(entry);
    } catch {
      // Best-effort rollback: continue with remaining snapshots rather than masking the original error.
    }
  }
  return reverted;
}

function formatCause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}
