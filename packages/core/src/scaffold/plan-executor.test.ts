import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScaffoldPlan } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExeca } = vi.hoisted(() => ({ mockExeca: vi.fn() }));
vi.mock('execa', () => ({ execa: mockExeca }));

const { executeScaffoldPlan, UnsafeScaffoldPathError } = await import('./plan-executor.js');

describe('executeScaffoldPlan', () => {
  let projectDir: string;
  let parentDir: string;

  beforeEach(async () => {
    parentDir = await mkdtemp(join(tmpdir(), 'spex-exec-parent-'));
    projectDir = join(parentDir, 'demo');
    mockExeca.mockReset();
  });
  afterEach(async () => {
    await rm(parentDir, { recursive: true, force: true });
  });

  it('runs the first command in parentDir and subsequent commands in projectDir', async () => {
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const plan: ScaffoldPlan = {
      stackLabel: 'X',
      steps: [
        { kind: 'command', cmd: 'create', args: ['demo'], rationale: 'scaffold' },
        { kind: 'command', cmd: 'pnpm', args: ['install'], rationale: 'install deps' },
      ],
      postConditions: ['demo exists'],
    };
    const result = await executeScaffoldPlan({ plan, parentDir, projectDir });
    expect(result.failure).toBeNull();
    expect(result.appliedSteps).toBe(2);
    expect(mockExeca).toHaveBeenNthCalledWith(
      1,
      'create',
      ['demo'],
      expect.objectContaining({ cwd: parentDir }),
    );
    expect(mockExeca).toHaveBeenNthCalledWith(
      2,
      'pnpm',
      ['install'],
      expect.objectContaining({ cwd: projectDir }),
    );
  });

  it('writes file steps relative to projectDir', async () => {
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const plan: ScaffoldPlan = {
      stackLabel: 'X',
      steps: [
        { kind: 'command', cmd: 'mkdir', args: ['demo'], rationale: 'mk' },
        {
          kind: 'file',
          path: 'src/hello.ts',
          content: "export const hi = 'world';\n",
          rationale: 'sample file',
        },
      ],
      postConditions: ['src/hello.ts exists'],
    };
    await executeScaffoldPlan({ plan, parentDir, projectDir });
    const written = await readFile(join(projectDir, 'src', 'hello.ts'), 'utf8');
    expect(written).toContain('hi');
  });

  it('returns a failure record when a command step fails (does not throw)', async () => {
    mockExeca.mockRejectedValue(
      Object.assign(new Error('boom'), { exitCode: 7, stderr: 'unknown flag', stdout: '' }),
    );
    const plan: ScaffoldPlan = {
      stackLabel: 'X',
      steps: [{ kind: 'command', cmd: 'pnpm', args: ['create', 'broken'], rationale: 'scaffold' }],
      postConditions: ['demo exists'],
    };
    const result = await executeScaffoldPlan({ plan, parentDir, projectDir });
    expect(result.appliedSteps).toBe(0);
    expect(result.failure).not.toBeNull();
    expect(result.failure?.exitCode).toBe(7);
    expect(result.failure?.stderr).toContain('unknown flag');
  });

  it('stops at the first failing step and reports the index', async () => {
    mockExeca
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockRejectedValueOnce(
        Object.assign(new Error('bad'), { exitCode: 1, stderr: 'x', stdout: '' }),
      );
    const plan: ScaffoldPlan = {
      stackLabel: 'X',
      steps: [
        { kind: 'command', cmd: 'create', args: ['demo'], rationale: 'ok' },
        { kind: 'command', cmd: 'pnpm', args: ['add', 'thing'], rationale: 'fail' },
      ],
      postConditions: ['demo exists'],
    };
    const result = await executeScaffoldPlan({ plan, parentDir, projectDir });
    expect(result.appliedSteps).toBe(1);
    expect(result.failure?.stepIndex).toBe(1);
  });

  it('rejects absolute file paths to prevent escaping the project directory', async () => {
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const plan: ScaffoldPlan = {
      stackLabel: 'X',
      steps: [
        { kind: 'command', cmd: 'mkdir', args: ['demo'], rationale: 'mk' },
        {
          kind: 'file',
          path: '/etc/passwd',
          content: 'pwn',
          rationale: 'evil',
        },
      ],
      postConditions: ['none'],
    };
    await expect(executeScaffoldPlan({ plan, parentDir, projectDir })).rejects.toBeInstanceOf(
      UnsafeScaffoldPathError,
    );
  });

  it('rejects ../-escape file paths', async () => {
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const plan: ScaffoldPlan = {
      stackLabel: 'X',
      steps: [
        { kind: 'command', cmd: 'mkdir', args: ['demo'], rationale: 'mk' },
        {
          kind: 'file',
          path: '../outside.ts',
          content: 'pwn',
          rationale: 'evil',
        },
      ],
      postConditions: ['none'],
    };
    await expect(executeScaffoldPlan({ plan, parentDir, projectDir })).rejects.toBeInstanceOf(
      UnsafeScaffoldPathError,
    );
  });
});
