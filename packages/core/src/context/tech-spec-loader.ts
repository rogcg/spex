import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type TechSpec, TechSpecSchema } from '@spex/schemas';
import { parse as parseYaml } from 'yaml';
import { SpexError } from '../errors.js';

export class InvalidTechSpecError extends SpexError {
  readonly path: string;

  constructor(path: string, cause?: unknown) {
    super(
      `Invalid tech-spec at ${path}. The file exists but does not match the TechSpec schema.`,
      cause === undefined ? undefined : { cause },
    );
    this.path = path;
  }
}

export async function loadTechSpec(projectDir: string): Promise<TechSpec | null> {
  const path = join(projectDir, '.ai', 'tech-spec.yaml');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (cause) {
    throw new InvalidTechSpecError(path, cause);
  }

  const result = TechSpecSchema.safeParse(parsed);
  if (!result.success) {
    throw new InvalidTechSpecError(path, result.error);
  }
  return result.data;
}
