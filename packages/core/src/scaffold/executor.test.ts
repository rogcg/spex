import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandFailedError } from './executor.js';

const { mockExeca } = vi.hoisted(() => ({ mockExeca: vi.fn() }));

vi.mock('execa', () => ({ execa: mockExeca }));

const { runCommand } = await import('./executor.js');

describe('runCommand', () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  it('calls execa with the bin, args, cwd, and default stdio of "inherit"', async () => {
    mockExeca.mockResolvedValue(undefined);
    await runCommand('git', ['init'], { cwd: '/tmp/proj' });
    expect(mockExeca).toHaveBeenCalledWith('git', ['init'], {
      cwd: '/tmp/proj',
      stdio: 'inherit',
    });
  });

  it('uses the stdio override when provided', async () => {
    mockExeca.mockResolvedValue(undefined);
    await runCommand('echo', ['hi'], { cwd: '/tmp', stdio: 'pipe' });
    expect(mockExeca).toHaveBeenCalledWith('echo', ['hi'], {
      cwd: '/tmp',
      stdio: 'pipe',
    });
  });

  it('throws CommandFailedError with the exit code when execa rejects with an exitCode', async () => {
    const sdkError = Object.assign(new Error('non-zero exit'), { exitCode: 17 });
    mockExeca.mockRejectedValue(sdkError);

    await expect(runCommand('pnpm', ['nope'], { cwd: '/tmp' })).rejects.toMatchObject({
      name: 'CommandFailedError',
      exitCode: 17,
      bin: 'pnpm',
      args: ['nope'],
    });
  });

  it('throws CommandFailedError with null exitCode when execa rejects without one', async () => {
    mockExeca.mockRejectedValue(new Error('spawn ENOENT'));

    const err = await runCommand('missing', [], { cwd: '/tmp' }).catch((e) => e);
    expect(err).toBeInstanceOf(CommandFailedError);
    expect(err.exitCode).toBeNull();
  });

  it('preserves the original error as cause', async () => {
    const sdkError = Object.assign(new Error('boom'), { exitCode: 2 });
    mockExeca.mockRejectedValue(sdkError);

    const err = await runCommand('x', [], { cwd: '/tmp' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CommandFailedError);
    expect((err as { cause?: unknown }).cause).toBe(sdkError);
  });
});
