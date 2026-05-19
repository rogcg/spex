import { execa } from 'execa';
import { SpexError } from '../errors.js';

export class GitCommandError extends SpexError {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;

  constructor(opts: {
    args: readonly string[];
    cwd: string;
    exitCode: number | null;
    stderr: string;
    stdout: string;
    cause?: unknown;
  }) {
    super(
      `git ${opts.args.join(' ')} failed (exit ${opts.exitCode ?? 'unknown'}) in ${opts.cwd}: ${opts.stderr.trim() || opts.stdout.trim() || 'no output'}`,
      opts.cause === undefined ? undefined : { cause: opts.cause },
    );
    this.args = opts.args;
    this.cwd = opts.cwd;
    this.exitCode = opts.exitCode;
    this.stderr = opts.stderr;
    this.stdout = opts.stdout;
  }
}

export interface RunGitOptions {
  cwd: string;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
}

export interface RunGitResult {
  stdout: string;
  stderr: string;
}

/**
 * Run `git <args>` in `cwd`, capturing stdout/stderr. Throws GitCommandError on
 * non-zero exit. Callers that need to tolerate certain exit codes should catch
 * the error and inspect `exitCode`.
 */
export async function runGit(options: RunGitOptions): Promise<RunGitResult> {
  try {
    const result = await execa('git', options.args, {
      cwd: options.cwd,
      ...(options.env !== undefined ? { env: options.env } : {}),
      reject: true,
      stdio: 'pipe',
    });
    return {
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    };
  } catch (cause) {
    const exitCode = extractExitCode(cause);
    const stderr = extractStream(cause, 'stderr');
    const stdout = extractStream(cause, 'stdout');
    throw new GitCommandError({
      args: options.args,
      cwd: options.cwd,
      exitCode,
      stderr,
      stdout,
      cause,
    });
  }
}

function extractExitCode(error: unknown): number | null {
  if (error !== null && typeof error === 'object' && 'exitCode' in error) {
    const code = (error as { exitCode: unknown }).exitCode;
    if (typeof code === 'number') return code;
  }
  return null;
}

function extractStream(error: unknown, key: 'stdout' | 'stderr'): string {
  if (error !== null && typeof error === 'object' && key in error) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return '';
}
