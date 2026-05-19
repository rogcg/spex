import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BranchAlreadyExistsError,
  branchExists,
  createBranch,
  defaultBranchName,
} from './branch.js';
import { commitPaths } from './commit.js';
import { GitCommandError } from './run-git.js';
import {
  DirtyWorkingTreeError,
  NotAGitRepoError,
  assertCleanWorkingTree,
  assertGitRepo,
  getCurrentBranch,
} from './working-tree.js';

let projectDir: string;

async function initRepo(): Promise<void> {
  await execa('git', ['init', '--initial-branch=main'], { cwd: projectDir });
  await execa('git', ['config', 'user.email', 'spex-test@example.com'], { cwd: projectDir });
  await execa('git', ['config', 'user.name', 'SPEX Test'], { cwd: projectDir });
  await execa('git', ['config', 'commit.gpgSign', 'false'], { cwd: projectDir });
  await writeFile(join(projectDir, '.gitignore'), 'node_modules\n', 'utf8');
  await writeFile(join(projectDir, 'README.md'), '# demo\n', 'utf8');
  await execa('git', ['add', '.'], { cwd: projectDir });
  await execa(
    'git',
    [
      '-c',
      'user.email=spex-test@example.com',
      '-c',
      'user.name=SPEX Test',
      '-c',
      'commit.gpgSign=false',
      'commit',
      '-m',
      'initial',
    ],
    { cwd: projectDir },
  );
}

async function writeFileInRepo(rel: string, content: string): Promise<void> {
  const path = join(projectDir, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

describe('defaultBranchName', () => {
  it('prefixes with feature/ by default', () => {
    expect(defaultBranchName('add-pagination')).toBe('feature/add-pagination');
  });

  it('accepts a custom prefix', () => {
    expect(defaultBranchName('add-pagination', 'spex/')).toBe('spex/add-pagination');
  });
});

describe('assertGitRepo / assertCleanWorkingTree / getCurrentBranch', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-git-'));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('assertGitRepo throws NotAGitRepoError outside a git repo', async () => {
    await expect(assertGitRepo(projectDir)).rejects.toBeInstanceOf(NotAGitRepoError);
  });

  it('assertCleanWorkingTree passes on a freshly committed repo', async () => {
    await initRepo();
    await expect(assertCleanWorkingTree(projectDir)).resolves.toBeUndefined();
  });

  it('assertCleanWorkingTree throws DirtyWorkingTreeError when there are uncommitted changes', async () => {
    await initRepo();
    await writeFileInRepo('src/util.ts', 'export const x = 1;\n');
    await expect(assertCleanWorkingTree(projectDir)).rejects.toBeInstanceOf(DirtyWorkingTreeError);
  });

  it('getCurrentBranch returns the active branch name', async () => {
    await initRepo();
    expect(await getCurrentBranch(projectDir)).toBe('main');
  });
});

describe('createBranch / branchExists', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-git-'));
    await initRepo();
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('creates and switches to a new branch', async () => {
    await createBranch({ projectDir, branch: 'feature/add-pagination' });
    expect(await getCurrentBranch(projectDir)).toBe('feature/add-pagination');
    expect(await branchExists(projectDir, 'feature/add-pagination')).toBe(true);
  });

  it('throws BranchAlreadyExistsError when the branch already exists', async () => {
    await createBranch({ projectDir, branch: 'feature/add-pagination' });
    // Switch back to main and try to create the same branch again
    await execa('git', ['checkout', 'main'], { cwd: projectDir });
    await expect(
      createBranch({ projectDir, branch: 'feature/add-pagination' }),
    ).rejects.toBeInstanceOf(BranchAlreadyExistsError);
  });
});

describe('commitPaths', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-git-'));
    await initRepo();
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('stages the given paths and creates a single commit, returning its SHA', async () => {
    await writeFileInRepo('src/a.ts', 'export const a = 1;\n');
    await writeFileInRepo('src/b.ts', 'export const b = 1;\n');

    const result = await commitPaths({
      projectDir,
      paths: ['src/a.ts', 'src/b.ts'],
      message: 'feat(src): add a and b',
    });
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);

    const { stdout: log } = await execa('git', ['log', '-1', '--pretty=%B'], { cwd: projectDir });
    expect(log).toContain('feat(src): add a and b');

    // No uncommitted changes should remain
    const { stdout: status } = await execa('git', ['status', '--porcelain'], { cwd: projectDir });
    expect(status).toBe('');
  });

  it('rejects an empty paths array (no logical group to commit)', async () => {
    await expect(commitPaths({ projectDir, paths: [], message: 'feat: nothing' })).rejects.toThrow(
      /at least one path/,
    );
  });

  it('does not include unrelated unstaged changes in the commit', async () => {
    await writeFileInRepo('src/a.ts', 'export const a = 1;\n');
    await writeFileInRepo('src/b.ts', 'export const b = 1;\n');

    await commitPaths({
      projectDir,
      paths: ['src/a.ts'],
      message: 'feat(src): add a',
    });

    // src/b.ts must still be untracked
    const { stdout: status } = await execa('git', ['status', '--porcelain'], { cwd: projectDir });
    expect(status).toContain('?? src/b.ts');
  });
});

describe('GitCommandError', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-git-'));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('captures exit code, stderr, and args when a git command fails', async () => {
    await initRepo();
    try {
      await commitPaths({
        projectDir,
        paths: ['does-not-exist.ts'],
        message: 'feat: nope',
      });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GitCommandError);
      const e = error as GitCommandError;
      expect(e.exitCode).not.toBeNull();
      expect(e.args[0]).toBe('add');
    }
  });
});
