import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGithubSetupCommand } from './github-setup.js';

let projectDir: string;
let originalCwd: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  projectDir = join(
    tmpdir(),
    `spex-github-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(projectDir, { recursive: true });
  originalCwd = process.cwd();
  process.chdir(projectDir);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  logSpy.mockRestore();
});

describe('runGithubSetupCommand', () => {
  it('creates .github/workflows/ and writes both templates on a clean project', async () => {
    const result = await runGithubSetupCommand();
    expect(result.written).toEqual(['pr-review.yml', 'implement-from-issue.yml']);
    expect(result.skipped).toEqual([]);
    const workflowsDir = join(projectDir, '.github', 'workflows');
    const dirStat = await stat(workflowsDir);
    expect(dirStat.isDirectory()).toBe(true);
    const prContent = await readFile(join(workflowsDir, 'pr-review.yml'), 'utf8');
    expect(prContent).toContain('name: SPEX Review');
    const issueContent = await readFile(join(workflowsDir, 'implement-from-issue.yml'), 'utf8');
    expect(issueContent).toContain('name: SPEX Implement from Issue');
  });

  it('skips existing files when --force is not set', async () => {
    const workflowsDir = join(projectDir, '.github', 'workflows');
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(join(workflowsDir, 'pr-review.yml'), 'custom content', 'utf8');

    const result = await runGithubSetupCommand();
    expect(result.written).toEqual(['implement-from-issue.yml']);
    expect(result.skipped).toEqual(['pr-review.yml']);
    const preserved = await readFile(join(workflowsDir, 'pr-review.yml'), 'utf8');
    expect(preserved).toBe('custom content');
  });

  it('overwrites existing files when --force is set', async () => {
    const workflowsDir = join(projectDir, '.github', 'workflows');
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(join(workflowsDir, 'pr-review.yml'), 'custom content', 'utf8');

    const result = await runGithubSetupCommand({ force: true });
    expect(result.written).toEqual(['pr-review.yml', 'implement-from-issue.yml']);
    expect(result.skipped).toEqual([]);
    const overwritten = await readFile(join(workflowsDir, 'pr-review.yml'), 'utf8');
    expect(overwritten).toContain('name: SPEX Review');
  });

  it('summary log mentions --force hint when files were skipped without force', async () => {
    const workflowsDir = join(projectDir, '.github', 'workflows');
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(join(workflowsDir, 'pr-review.yml'), 'x', 'utf8');

    await runGithubSetupCommand();
    const logCalls = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logCalls).toMatch(/--force/);
  });
});
