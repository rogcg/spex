import { copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { type LoadSkillsOptions, loadSkills } from '@spex/skills';
import { STRINGS } from '../strings.js';

export type SkillsInstallScope = 'user' | 'project';

export interface RunSkillsInstallOptions {
  scope?: SkillsInstallScope;
  /** Override the destination root. Useful in tests; bypasses scope resolution. */
  destOverride?: string;
  /** Override the source skills root (forwarded to loadSkills). */
  sourceRootOverride?: string;
}

export async function runSkillsInstallCommand(
  options: RunSkillsInstallOptions = {},
): Promise<void> {
  const scope: SkillsInstallScope = options.scope ?? 'user';
  const dest = options.destOverride ?? resolveDest(scope);

  console.log(STRINGS.skillsInstallCommand.starting(scope, dest));

  const loadOptions: LoadSkillsOptions = options.sourceRootOverride
    ? { rootDir: options.sourceRootOverride }
    : {};
  const skills = await loadSkills(loadOptions);
  if (skills.length === 0) {
    console.log(STRINGS.skillsInstallCommand.noSkills);
    return;
  }

  let written = 0;
  for (const skill of skills) {
    const skillDir = join(dest, skill.manifest.name);
    await mkdir(skillDir, { recursive: true });
    const source = join(skill.dir, 'SKILL.md');
    const target = join(skillDir, 'SKILL.md');
    await copyFile(source, target);
    console.log(STRINGS.skillsInstallCommand.wrote(skill.manifest.name, target));
    written += 1;
  }

  console.log(STRINGS.skillsInstallCommand.done(written));
}

export function parseSkillsInstallScope(raw: string): SkillsInstallScope {
  if (raw === 'user' || raw === 'project') return raw;
  throw new Error(STRINGS.skillsInstallCommand.invalidScope(raw));
}

function resolveDest(scope: SkillsInstallScope): string {
  if (scope === 'user') {
    return resolve(homedir(), '.claude', 'skills');
  }
  return resolve(process.cwd(), '.claude', 'skills');
}
