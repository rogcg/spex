import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { ScaffoldPlan, ScaffoldStep } from '@spex/schemas';
import { execa } from 'execa';
import { SpexError } from '../errors.js';

export interface ExecuteScaffoldPlanOptions {
  plan: ScaffoldPlan;
  /** Directory the project should be created INSIDE. The first command typically runs here. */
  parentDir: string;
  /** Resolved path of the project directory (parentDir/projectName). Subsequent steps run here. */
  projectDir: string;
  stdio?: 'inherit' | 'pipe' | 'ignore';
}

export interface ScaffoldStepFailure {
  stepIndex: number;
  step: ScaffoldStep;
  exitCode: number | null;
  stderr: string;
  stdout: string;
  message: string;
}

export interface ExecuteScaffoldPlanResult {
  appliedSteps: number;
  failure: ScaffoldStepFailure | null;
}

export class UnsafeScaffoldPathError extends SpexError {
  constructor(path: string) {
    super(`Scaffold plan rejected: file path "${path}" escapes the project directory.`);
  }
}

export async function executeScaffoldPlan(
  opts: ExecuteScaffoldPlanOptions,
): Promise<ExecuteScaffoldPlanResult> {
  const stdio = opts.stdio ?? 'pipe';

  for (const [i, step] of opts.plan.steps.entries()) {
    const cwd = i === 0 && step.kind === 'command' ? opts.parentDir : opts.projectDir;

    if (step.kind === 'command') {
      const result = await runCommand(step.cmd, step.args, { cwd, stdio });
      if (result.failure) {
        return {
          appliedSteps: i,
          failure: {
            stepIndex: i,
            step,
            exitCode: result.failure.exitCode,
            stderr: result.failure.stderr,
            stdout: result.failure.stdout,
            message: result.failure.message,
          },
        };
      }
    } else {
      try {
        await writeFileStep(opts.projectDir, step.path, step.content);
      } catch (err) {
        if (err instanceof UnsafeScaffoldPathError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        return {
          appliedSteps: i,
          failure: {
            stepIndex: i,
            step,
            exitCode: null,
            stderr: message,
            stdout: '',
            message,
          },
        };
      }
    }
  }

  return { appliedSteps: opts.plan.steps.length, failure: null };
}

interface CommandRunOptions {
  cwd: string;
  stdio: 'inherit' | 'pipe' | 'ignore';
}

interface CommandRunResult {
  failure: { exitCode: number | null; stderr: string; stdout: string; message: string } | null;
}

async function runCommand(
  bin: string,
  args: readonly string[],
  opts: CommandRunOptions,
): Promise<CommandRunResult> {
  try {
    await execa(bin, args, { cwd: opts.cwd, stdio: opts.stdio });
    return { failure: null };
  } catch (err) {
    const exitCode = extractExitCode(err);
    const stderr = extractField(err, 'stderr');
    const stdout = extractField(err, 'stdout');
    const message = err instanceof Error ? err.message : String(err);
    return { failure: { exitCode, stderr, stdout, message } };
  }
}

function extractExitCode(err: unknown): number | null {
  if (err !== null && typeof err === 'object' && 'exitCode' in err) {
    const code = (err as { exitCode: unknown }).exitCode;
    if (typeof code === 'number') return code;
  }
  return null;
}

function extractField(err: unknown, field: 'stderr' | 'stdout'): string {
  if (err !== null && typeof err === 'object' && field in err) {
    const v = (err as Record<string, unknown>)[field];
    if (typeof v === 'string') return v;
  }
  return '';
}

async function writeFileStep(projectDir: string, relPath: string, content: string): Promise<void> {
  if (isAbsolute(relPath)) {
    throw new UnsafeScaffoldPathError(relPath);
  }
  const normalized = relPath.replace(/\\/g, '/');
  const resolved = resolve(projectDir, normalized);
  const projectPrefix = resolve(projectDir) + sep;
  if (resolved !== resolve(projectDir) && !resolved.startsWith(projectPrefix)) {
    throw new UnsafeScaffoldPathError(relPath);
  }
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, content, 'utf8');
}

export function joinProjectPath(projectDir: string, relPath: string): string {
  return join(projectDir, relPath);
}
