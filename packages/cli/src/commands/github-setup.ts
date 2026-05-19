import { access, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { WORKFLOW_TEMPLATES, getWorkflowTemplate } from '@spex/integrations-github';
import { STRINGS } from '../strings.js';

export interface GithubSetupCommandOptions {
  force?: boolean;
}

export interface GithubSetupResult {
  written: readonly string[];
  skipped: readonly string[];
}

export async function runGithubSetupCommand(
  options: GithubSetupCommandOptions = {},
): Promise<GithubSetupResult> {
  const projectDir = resolve(process.cwd());
  const workflowsDir = join(projectDir, '.github', 'workflows');
  await mkdir(workflowsDir, { recursive: true });

  console.log(STRINGS.githubSetupCommand.starting(workflowsDir));

  const written: string[] = [];
  const skipped: string[] = [];

  for (const meta of WORKFLOW_TEMPLATES) {
    const targetPath = join(workflowsDir, meta.filename);
    const relativePath = join('.github', 'workflows', meta.filename);

    if ((await fileExists(targetPath)) && !options.force) {
      console.log(STRINGS.githubSetupCommand.skipped(relativePath));
      skipped.push(meta.filename);
      continue;
    }

    const template = await getWorkflowTemplate(meta.name);
    await writeFile(targetPath, template.content, 'utf8');
    console.log(STRINGS.githubSetupCommand.wrote(relativePath));
    written.push(meta.filename);
  }

  console.log(
    STRINGS.githubSetupCommand.summary({
      written: written.length,
      skipped: skipped.length,
      forceUsed: options.force === true,
    }),
  );

  return { written, skipped };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
