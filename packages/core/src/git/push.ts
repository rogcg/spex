import { runGit } from './run-git.js';

export interface PushBranchOptions {
  projectDir: string;
  branch: string;
  remote?: string;
  setUpstream?: boolean;
}

export async function pushBranch(options: PushBranchOptions): Promise<void> {
  const remote = options.remote ?? 'origin';
  const args = ['push'];
  if (options.setUpstream !== false) {
    args.push('-u');
  }
  args.push(remote, options.branch);
  await runGit({ cwd: options.projectDir, args });
}
