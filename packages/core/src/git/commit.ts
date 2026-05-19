import { runGit } from './run-git.js';

export interface CommitPathsOptions {
  projectDir: string;
  paths: readonly string[];
  message: string;
}

export interface CommitResult {
  sha: string;
}

/**
 * Stages the given paths (passed to `git add -- <paths>`) and creates a single
 * commit with the provided message. Returns the resulting commit SHA.
 *
 * The paths are passed verbatim to `git add` — callers are responsible for
 * providing only paths that belong to this logical group of changes. This keeps
 * the commit atomic per group.
 */
export async function commitPaths(options: CommitPathsOptions): Promise<CommitResult> {
  if (options.paths.length === 0) {
    throw new Error('commitPaths requires at least one path');
  }
  await runGit({
    cwd: options.projectDir,
    args: ['add', '--', ...options.paths],
  });
  await runGit({
    cwd: options.projectDir,
    args: ['commit', '-m', options.message],
  });
  const { stdout } = await runGit({
    cwd: options.projectDir,
    args: ['rev-parse', 'HEAD'],
  });
  return { sha: stdout.trim() };
}
