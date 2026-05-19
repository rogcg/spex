import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunCommand } = vi.hoisted(() => ({ mockRunCommand: vi.fn() }));

vi.mock('./executor.js', () => ({ runCommand: mockRunCommand }));

const { scaffoldNextJsApp } = await import('./nextjs.js');

describe('scaffoldNextJsApp', () => {
  beforeEach(() => {
    mockRunCommand.mockReset();
    mockRunCommand.mockResolvedValue(undefined);
  });

  it('invokes pnpm create next-app with the canonical flag set', async () => {
    await scaffoldNextJsApp({ projectName: 'my-saas', parentDir: '/tmp' });

    expect(mockRunCommand).toHaveBeenCalledTimes(1);
    expect(mockRunCommand).toHaveBeenCalledWith(
      'pnpm',
      [
        'create',
        'next-app@latest',
        'my-saas',
        '--typescript',
        '--tailwind',
        '--app',
        '--src-dir',
        '--import-alias',
        '@/*',
        '--use-pnpm',
      ],
      { cwd: '/tmp' },
    );
  });

  it('passes the project name verbatim as a separate argv entry (no shell interpolation)', async () => {
    await scaffoldNextJsApp({
      projectName: 'name-with spaces',
      parentDir: '/tmp',
    });
    const call = mockRunCommand.mock.calls[0];
    expect(call?.[1]).toContain('name-with spaces');
  });
});
