import { rm } from 'node:fs/promises';
import type { ScaffoldPlan, StackDecision } from '@spex/schemas';
import { SpexError } from '../errors.js';
import type { LLMProvider } from '../llm/provider.js';
import { planScaffold, repairScaffoldPlan } from './dynamic-planner.js';
import { type ExecuteScaffoldPlanOptions, executeScaffoldPlan } from './plan-executor.js';
import { type VerifyScaffoldOptions, verifyScaffold } from './verifier.js';

export interface RunScaffoldAttempt {
  attempt: number;
  plan: ScaffoldPlan;
  appliedSteps: number;
  verification: { ok: boolean; failedPostConditions: readonly string[]; notes: string };
  commandFailure: {
    cmd: string;
    args: readonly string[];
    exitCode: number | null;
    stderr: string;
  } | null;
}

export interface RunScaffoldResult {
  ok: boolean;
  plan: ScaffoldPlan;
  attempts: RunScaffoldAttempt[];
}

export interface RunScaffoldOptions {
  llm: LLMProvider;
  projectName: string;
  parentDir: string;
  projectDir: string;
  decision: StackDecision;
  maxAttempts?: number;
  /**
   * If true, the project directory is removed between attempts so each retry
   * starts clean. Defaults to true. Disable for tests that pre-populate state.
   */
  cleanBetweenAttempts?: boolean;
  /** Hook for logging progress; defaults to noop. */
  onEvent?: (event: ScaffoldRunnerEvent) => void;
  /** Test seam: override the plan-execution implementation. */
  execute?: (opts: ExecuteScaffoldPlanOptions) => ReturnType<typeof executeScaffoldPlan>;
  /** Test seam: override the verifier. */
  verify?: (opts: VerifyScaffoldOptions) => ReturnType<typeof verifyScaffold>;
  /** Test seam: pass a fixed plan instead of calling the LLM planner. */
  initialPlan?: ScaffoldPlan;
}

export type ScaffoldRunnerEvent =
  | { kind: 'planning' }
  | { kind: 'plan-ready'; plan: ScaffoldPlan }
  | { kind: 'attempt-start'; attempt: number; max: number }
  | { kind: 'attempt-failed'; attempt: number; reason: string }
  | { kind: 'attempt-ok'; attempt: number }
  | { kind: 'repairing'; attempt: number }
  | { kind: 'aborting'; attempts: number };

export class ScaffoldFailedError extends SpexError {
  readonly attempts: readonly RunScaffoldAttempt[];

  constructor(attempts: readonly RunScaffoldAttempt[]) {
    super(`Scaffold failed after ${attempts.length} attempt(s).`);
    this.attempts = attempts;
  }
}

const DEFAULT_MAX_ATTEMPTS = 3;

export async function runScaffold(opts: RunScaffoldOptions): Promise<RunScaffoldResult> {
  const max = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const cleanBetween = opts.cleanBetweenAttempts ?? true;
  const onEvent = opts.onEvent ?? (() => {});
  const execute = opts.execute ?? executeScaffoldPlan;
  const verify = opts.verify ?? verifyScaffold;

  const attempts: RunScaffoldAttempt[] = [];

  let plan = opts.initialPlan;
  if (!plan) {
    onEvent({ kind: 'planning' });
    plan = await planScaffold({
      llm: opts.llm,
      projectName: opts.projectName,
      decision: opts.decision,
    });
    onEvent({ kind: 'plan-ready', plan });
  }

  for (let attempt = 1; attempt <= max; attempt++) {
    onEvent({ kind: 'attempt-start', attempt, max });
    if (attempt > 1 && cleanBetween) {
      await rm(opts.projectDir, { recursive: true, force: true });
    }

    const execResult = await execute({
      plan,
      parentDir: opts.parentDir,
      projectDir: opts.projectDir,
    });

    let attemptRecord: RunScaffoldAttempt;
    if (execResult.failure) {
      const fail = execResult.failure;
      attemptRecord = {
        attempt,
        plan,
        appliedSteps: execResult.appliedSteps,
        verification: { ok: false, failedPostConditions: [], notes: fail.message },
        commandFailure:
          fail.step.kind === 'command'
            ? {
                cmd: fail.step.cmd,
                args: fail.step.args,
                exitCode: fail.exitCode,
                stderr: fail.stderr,
              }
            : {
                cmd: 'write-file',
                args: [fail.step.path],
                exitCode: fail.exitCode,
                stderr: fail.stderr,
              },
      };
      attempts.push(attemptRecord);
      onEvent({ kind: 'attempt-failed', attempt, reason: fail.message });
    } else {
      const verification = await verify({ plan, projectDir: opts.projectDir });
      attemptRecord = {
        attempt,
        plan,
        appliedSteps: execResult.appliedSteps,
        verification,
        commandFailure: null,
      };
      attempts.push(attemptRecord);

      if (verification.ok) {
        onEvent({ kind: 'attempt-ok', attempt });
        return { ok: true, plan, attempts };
      }
      onEvent({
        kind: 'attempt-failed',
        attempt,
        reason: `failed post-conditions: ${verification.failedPostConditions.join(', ')}`,
      });
    }

    if (attempt < max) {
      onEvent({ kind: 'repairing', attempt });
      plan = await repairScaffoldPlan({
        llm: opts.llm,
        projectName: opts.projectName,
        decision: opts.decision,
        previousPlan: plan,
        failure: {
          failedPostConditions: attemptRecord.verification.failedPostConditions,
          commandFailures: attemptRecord.commandFailure ? [attemptRecord.commandFailure] : [],
          notes: attemptRecord.verification.notes,
        },
      });
    }
  }

  onEvent({ kind: 'aborting', attempts: attempts.length });
  throw new ScaffoldFailedError(attempts);
}
