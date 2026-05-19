import { SpexError } from '../errors.js';
import { GitCommandError, runGit } from './run-git.js';

const DEFAULT_BRANCH_PREFIX = 'feature/';

export class BranchAlreadyExistsError extends SpexError {
  readonly branch: string;
  constructor(branch: string) {
    super(`Branch already exists: ${branch}. Choose a different name or delete the branch.`);
    this.branch = branch;
  }
}

export function defaultBranchName(slug: string, prefix: string = DEFAULT_BRANCH_PREFIX): string {
  return `${prefix}${slug}`;
}

export interface CreateBranchOptions {
  projectDir: string;
  branch: string;
}

export async function createBranch(options: CreateBranchOptions): Promise<void> {
  if (await branchExists(options.projectDir, options.branch)) {
    throw new BranchAlreadyExistsError(options.branch);
  }
  await runGit({
    cwd: options.projectDir,
    args: ['checkout', '-b', options.branch],
  });
}

export async function branchExists(projectDir: string, branch: string): Promise<boolean> {
  try {
    await runGit({
      cwd: projectDir,
      args: ['rev-parse', '--verify', `refs/heads/${branch}`],
    });
    return true;
  } catch (error) {
    if (error instanceof GitCommandError && error.exitCode !== null) {
      return false;
    }
    throw error;
  }
}
