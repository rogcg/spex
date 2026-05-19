import { execa } from 'execa';
import { SpexError } from '../errors.js';

export class CommandFailedError extends SpexError {
  readonly bin: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;

  constructor(bin: string, args: readonly string[], exitCode: number | null, cause?: unknown) {
    super(
      `Command failed (exit ${exitCode ?? 'unknown'}): ${bin} ${args.join(' ')}`,
      cause === undefined ? undefined : { cause },
    );
    this.bin = bin;
    this.args = args;
    this.exitCode = exitCode;
  }
}

export interface RunCommandOptions {
  cwd: string;
  stdio?: 'inherit' | 'pipe' | 'ignore';
}

export async function runCommand(
  bin: string,
  args: readonly string[],
  options: RunCommandOptions,
): Promise<void> {
  try {
    await execa(bin, args, {
      cwd: options.cwd,
      stdio: options.stdio ?? 'inherit',
    });
  } catch (error) {
    throw new CommandFailedError(bin, args, extractExitCode(error), error);
  }
}

function extractExitCode(error: unknown): number | null {
  if (error !== null && typeof error === 'object' && 'exitCode' in error) {
    const code = (error as { exitCode: unknown }).exitCode;
    if (typeof code === 'number') {
      return code;
    }
  }
  return null;
}
