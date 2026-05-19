import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import type { RegressionTest } from '@spex/schemas';
import { execa } from 'execa';
import { SpexError } from '../errors.js';
import { resolveInsideProject } from '../implementation/safety.js';

export class RegressionTestDidNotFailError extends SpexError {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(opts: { stdout: string; stderr: string; exitCode: number | null }) {
    super(
      'Regression test passed BEFORE the fix was applied — it does not actually reproduce the bug. Re-generate the test or revise the root cause.',
    );
    this.stdout = opts.stdout;
    this.stderr = opts.stderr;
    this.exitCode = opts.exitCode;
  }
}

export class RegressionTestDidNotPassError extends SpexError {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(opts: { stdout: string; stderr: string; exitCode: number | null }) {
    super(
      'Regression test still failed AFTER the fix was applied — the proposed fix does not address the bug, or the test is checking the wrong thing.',
    );
    this.stdout = opts.stdout;
    this.stderr = opts.stderr;
    this.exitCode = opts.exitCode;
  }
}

export interface RegressionRunOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface VerifyRegressionTestOptions {
  projectDir: string;
  regressionTest: RegressionTest;
  /** Applies the fix that should make the test pass. */
  applyFix: () => Promise<void>;
  /** Reverts whatever `applyFix` did. Called when verification fails. */
  revertFix: () => Promise<void>;
  /**
   * Override the test-runner command. By default, derived from
   * `regressionTest.framework`: vitest → `npx vitest run <path>`, jest →
   * `npx jest <path>`.
   */
  testCommand?: {
    bin: string;
    args?: readonly string[];
    /** When true, the resolved absolute path of the test file is appended as the last argument. Default true. */
    appendTestPath?: boolean;
  };
  /** Per-run timeout. Defaults to 60 seconds. */
  timeoutMs?: number;
  /**
   * If true, removes the test file even on a successful verification. Default
   * false — successful verification leaves the test in place so the caller can
   * commit it alongside the fix.
   */
  removeTestOnSuccess?: boolean;
}

export interface VerifyRegressionTestResult {
  failedBeforeFix: boolean;
  passedAfterFix: boolean;
  beforeRun: RegressionRunOutput;
  afterRun: RegressionRunOutput;
  testPath: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export async function verifyRegressionTest(
  opts: VerifyRegressionTestOptions,
): Promise<VerifyRegressionTestResult> {
  const projectDir = resolvePath(opts.projectDir);
  const absoluteTestPath = resolveInsideProject(projectDir, opts.regressionTest.path);
  const command = resolveTestCommand(opts);

  const preExisting = await captureExistingFile(absoluteTestPath);

  // Write the regression test file.
  await mkdir(dirname(absoluteTestPath), { recursive: true });
  await writeFile(absoluteTestPath, opts.regressionTest.content, 'utf8');

  let beforeRun: RegressionRunOutput;
  try {
    beforeRun = await runTest(command, projectDir, absoluteTestPath, opts.timeoutMs);
  } catch (cause) {
    await restoreFile(absoluteTestPath, preExisting);
    throw cause;
  }

  if (beforeRun.exitCode === 0) {
    await restoreFile(absoluteTestPath, preExisting);
    throw new RegressionTestDidNotFailError(beforeRun);
  }

  // Apply the fix.
  try {
    await opts.applyFix();
  } catch (cause) {
    await restoreFile(absoluteTestPath, preExisting);
    throw cause;
  }

  let afterRun: RegressionRunOutput;
  try {
    afterRun = await runTest(command, projectDir, absoluteTestPath, opts.timeoutMs);
  } catch (cause) {
    await opts.revertFix();
    await restoreFile(absoluteTestPath, preExisting);
    throw cause;
  }

  if (afterRun.exitCode !== 0) {
    await opts.revertFix();
    await restoreFile(absoluteTestPath, preExisting);
    throw new RegressionTestDidNotPassError(afterRun);
  }

  if (opts.removeTestOnSuccess) {
    await restoreFile(absoluteTestPath, preExisting);
  }

  return {
    failedBeforeFix: true,
    passedAfterFix: true,
    beforeRun,
    afterRun,
    testPath: opts.regressionTest.path,
  };
}

interface ResolvedTestCommand {
  bin: string;
  args: string[];
  appendTestPath: boolean;
}

function resolveTestCommand(opts: VerifyRegressionTestOptions): ResolvedTestCommand {
  if (opts.testCommand) {
    return {
      bin: opts.testCommand.bin,
      args: [...(opts.testCommand.args ?? [])],
      appendTestPath: opts.testCommand.appendTestPath ?? true,
    };
  }
  if (opts.regressionTest.framework === 'vitest') {
    return { bin: 'npx', args: ['vitest', 'run'], appendTestPath: true };
  }
  return { bin: 'npx', args: ['jest', '--runTestsByPath'], appendTestPath: true };
}

async function runTest(
  command: ResolvedTestCommand,
  cwd: string,
  testPath: string,
  timeoutMs: number | undefined,
): Promise<RegressionRunOutput> {
  const args = command.appendTestPath ? [...command.args, testPath] : command.args;
  try {
    const result = await execa(command.bin, args, {
      cwd,
      reject: false,
      timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
      stdio: 'pipe',
    });
    return {
      exitCode: result.exitCode ?? null,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    };
  } catch (cause) {
    // execa with reject=false should not throw on non-zero exit; this branch
    // catches spawn failures (bin not found, timeout exceeded).
    return {
      exitCode: extractExitCode(cause),
      stdout: '',
      stderr: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

function extractExitCode(error: unknown): number | null {
  if (error !== null && typeof error === 'object' && 'exitCode' in error) {
    const code = (error as { exitCode: unknown }).exitCode;
    if (typeof code === 'number') return code;
  }
  return null;
}

interface ExistingFileSnapshot {
  existed: boolean;
  contentBefore: string | null;
}

async function captureExistingFile(absolutePath: string): Promise<ExistingFileSnapshot> {
  try {
    const s = await stat(absolutePath);
    if (!s.isFile()) {
      return { existed: false, contentBefore: null };
    }
    return { existed: true, contentBefore: await readFile(absolutePath, 'utf8') };
  } catch {
    return { existed: false, contentBefore: null };
  }
}

async function restoreFile(absolutePath: string, snapshot: ExistingFileSnapshot): Promise<void> {
  if (snapshot.existed && snapshot.contentBefore !== null) {
    await writeFile(absolutePath, snapshot.contentBefore, 'utf8');
  } else {
    await rm(absolutePath, { force: true });
  }
}
