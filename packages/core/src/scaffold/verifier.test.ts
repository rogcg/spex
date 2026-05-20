import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScaffoldPlan } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyScaffold } from './verifier.js';

function passingShell() {
  return vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
}

let projectDir: string;
beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'spex-verify-'));
});
afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('verifyScaffold', () => {
  it('passes when every post-condition holds', async () => {
    await writeFile(
      join(projectDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '15' } }),
    );
    await mkdir(join(projectDir, 'src', 'app'), { recursive: true });
    await writeFile(
      join(projectDir, 'src', 'app', 'page.tsx'),
      'export default function Page(){return null}',
    );
    const plan: ScaffoldPlan = {
      stackLabel: 'Next.js',
      steps: [{ kind: 'command', cmd: 'x', args: [], rationale: 'r' }],
      postConditions: ['package.json declares "next" dependency', 'src/app/page.tsx exists'],
    };
    const result = await verifyScaffold({ plan, projectDir, runShell: passingShell() });
    expect(result.ok).toBe(true);
    expect(result.failedPostConditions).toEqual([]);
  });

  it('reports the specific post-condition that fails when a file is missing', async () => {
    await writeFile(join(projectDir, 'package.json'), JSON.stringify({ dependencies: {} }));
    const plan: ScaffoldPlan = {
      stackLabel: 'Next.js',
      steps: [{ kind: 'command', cmd: 'x', args: [], rationale: 'r' }],
      postConditions: ['drizzle.config.ts exists'],
    };
    const result = await verifyScaffold({ plan, projectDir, runShell: passingShell() });
    expect(result.ok).toBe(false);
    expect(result.failedPostConditions).toContain('drizzle.config.ts exists');
    expect(result.notes).toContain('file not found');
  });

  it('reports the specific post-condition that fails when a declared dependency is missing', async () => {
    await writeFile(
      join(projectDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '19' } }),
    );
    const plan: ScaffoldPlan = {
      stackLabel: 'Next.js',
      steps: [{ kind: 'command', cmd: 'x', args: [], rationale: 'r' }],
      postConditions: ['package.json declares "next" dependency'],
    };
    const result = await verifyScaffold({ plan, projectDir, runShell: passingShell() });
    expect(result.ok).toBe(false);
    expect(result.failedPostConditions).toEqual(['package.json declares "next" dependency']);
  });

  it('runs a typecheck command for typecheck post-conditions and reports failure when it exits non-zero', async () => {
    const plan: ScaffoldPlan = {
      stackLabel: 'Next.js',
      steps: [{ kind: 'command', cmd: 'x', args: [], rationale: 'r' }],
      postConditions: ['typecheck passes'],
    };
    const failingShell = vi.fn().mockResolvedValue({ exitCode: 2, stdout: '', stderr: 'TS2304' });
    const result = await verifyScaffold({ plan, projectDir, runShell: failingShell });
    expect(result.ok).toBe(false);
    expect(failingShell).toHaveBeenCalledWith('pnpm', ['exec', 'tsc', '--noEmit'], projectDir);
  });

  it('treats informational post-conditions (no recognized trigger) as satisfied', async () => {
    const plan: ScaffoldPlan = {
      stackLabel: 'X',
      steps: [{ kind: 'command', cmd: 'x', args: [], rationale: 'r' }],
      postConditions: ['the project follows the chosen architecture'],
    };
    const result = await verifyScaffold({ plan, projectDir, runShell: passingShell() });
    expect(result.ok).toBe(true);
  });
});
