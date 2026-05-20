import type { Dirent } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export class SkillsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SkillsError';
  }
}

export const SkillManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, 'name must be kebab-case'),
  description: z.string().min(1),
  'allowed-tools': z.array(z.string()).optional(),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export interface LoadedSkill {
  manifest: SkillManifest;
  /** The Markdown body of SKILL.md, excluding the YAML frontmatter block. */
  body: string;
  /** Absolute path to the directory containing the skill's SKILL.md. */
  dir: string;
}

export interface LoadSkillsOptions {
  /**
   * Override the directory to search for skill subdirectories. Defaults to
   * the `@spex/skills` package root (one level up from the built/loader file).
   */
  rootDir?: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export async function loadSkills(options: LoadSkillsOptions = {}): Promise<LoadedSkill[]> {
  const rootDir = options.rootDir ?? defaultRootDir();
  let entries: Dirent[];
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    throw new SkillsError(`Could not read skills directory: ${rootDir}`, { cause: error });
  }
  const skills: LoadedSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(rootDir, entry.name);
    const skillPath = join(dir, 'SKILL.md');
    let raw: string;
    try {
      raw = await readFile(skillPath, 'utf8');
    } catch {
      continue; // not a skill directory
    }
    const match = FRONTMATTER_RE.exec(raw);
    if (!match) {
      throw new SkillsError(`Missing YAML frontmatter in ${skillPath}`);
    }
    const fmYaml = match[1] ?? '';
    const body = match[2] ?? '';
    let parsedFm: unknown;
    try {
      parsedFm = parseYaml(fmYaml);
    } catch (error) {
      throw new SkillsError(`Could not parse frontmatter YAML in ${skillPath}`, { cause: error });
    }
    const result = SkillManifestSchema.safeParse(parsedFm);
    if (!result.success) {
      throw new SkillsError(
        `Invalid SKILL.md frontmatter in ${skillPath}: ${result.error.message}`,
      );
    }
    skills.push({ manifest: result.data, body, dir });
  }
  skills.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  return skills;
}

export async function getSkill(
  name: string,
  options: LoadSkillsOptions = {},
): Promise<LoadedSkill | null> {
  const skills = await loadSkills(options);
  return skills.find((s) => s.manifest.name === name) ?? null;
}

function defaultRootDir(): string {
  // From `dist/index.js` or `src/loader.ts`, resolve up one level to the
  // package root where the skill subdirectories live.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..');
}
