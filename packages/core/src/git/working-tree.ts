import { SpexError } from '../errors.js';
import { runGit } from './run-git.js';

export class DirtyWorkingTreeError extends SpexError {
  readonly projectDir: string;
  readonly entries: readonly string[];

  constructor(projectDir: string, entries: readonly string[]) {
    super(
      `Working tree at ${projectDir} has uncommitted changes. Commit or stash them before running this command.\n${entries
        .map((line) => `  ${line}`)
        .join('\n')}`,
    );
    this.projectDir = projectDir;
    this.entries = entries;
  }
}

export class NotAGitRepoError extends SpexError {
  readonly projectDir: string;

  constructor(projectDir: string) {
    super(`Directory is not inside a git repository: ${projectDir}`);
    this.projectDir = projectDir;
  }
}

export async function assertGitRepo(projectDir: string): Promise<void> {
  try {
    await runGit({ cwd: projectDir, args: ['rev-parse', '--is-inside-work-tree'] });
  } catch {
    throw new NotAGitRepoError(projectDir);
  }
}

export async function assertCleanWorkingTree(projectDir: string): Promise<void> {
  await assertGitRepo(projectDir);
  const { stdout } = await runGit({
    cwd: projectDir,
    args: ['status', '--porcelain'],
  });
  const lines = stdout.split('\n').filter((line) => line.length > 0);
  if (lines.length > 0) {
    throw new DirtyWorkingTreeError(projectDir, lines);
  }
}

export async function getCurrentBranch(projectDir: string): Promise<string> {
  const { stdout } = await runGit({
    cwd: projectDir,
    args: ['rev-parse', '--abbrev-ref', 'HEAD'],
  });
  return stdout.trim();
}
