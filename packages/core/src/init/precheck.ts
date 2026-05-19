import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { SpexError } from '../errors.js';

export class AiFolderExistsError extends SpexError {
  readonly path: string;

  constructor(path: string) {
    super(
      `.ai/ already exists at ${path}. Re-run with --force to overwrite, or remove it manually.`,
    );
    this.path = path;
  }
}

export interface AssertAiFolderAbsentOptions {
  projectDir: string;
  force?: boolean;
}

export async function assertAiFolderAbsent(opts: AssertAiFolderAbsentOptions): Promise<void> {
  if (opts.force) {
    return;
  }
  const aiDir = join(opts.projectDir, '.ai');
  try {
    const s = await stat(aiDir);
    if (s.isDirectory()) {
      throw new AiFolderExistsError(aiDir);
    }
  } catch (error) {
    if (error instanceof AiFolderExistsError) {
      throw error;
    }
    // ENOENT or any other "does not exist" outcome: precheck passes.
  }
}
