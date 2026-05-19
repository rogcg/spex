import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type FeatureSpec, FeatureSpecSchema } from '@spex/schemas';
import { parse as parseYaml } from 'yaml';

export interface LoadFeatureSpecOptions {
  projectDir: string;
  relativePath: string;
}

/**
 * Read and validate a feature spec at `<projectDir>/<relativePath>`. Returns
 * `null` when the file is missing or fails schema validation — callers that
 * need a "missing vs invalid" distinction should use a stricter path.
 */
export async function loadFeatureSpec(
  options: LoadFeatureSpecOptions,
): Promise<FeatureSpec | null> {
  try {
    const raw = await readFile(join(options.projectDir, options.relativePath), 'utf8');
    const parsed: unknown = parseYaml(raw);
    const result = FeatureSpecSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
