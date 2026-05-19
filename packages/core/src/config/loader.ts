import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type AiConfig, AiConfigSchema } from '@spex/schemas';
import { parse as parseYaml } from 'yaml';
import { SpexError } from '../errors.js';

export class InvalidAiConfigError extends SpexError {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid .ai/config.yaml: ${issues.join('; ')}`);
    this.issues = issues;
  }
}

export interface LoadAiConfigOptions {
  projectDir: string;
}

/**
 * Read and validate `.ai/config.yaml` from the project directory.
 * Returns `null` when the file does not exist (a missing config is not an error).
 * Throws `InvalidAiConfigError` when the file exists but fails schema validation.
 */
export async function loadAiConfig(options: LoadAiConfigOptions): Promise<AiConfig | null> {
  const path = join(options.projectDir, '.ai', 'config.yaml');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    if (isEnoent(cause)) {
      return null;
    }
    throw cause;
  }
  const parsed: unknown = parseYaml(raw) ?? {};
  const result = AiConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new InvalidAiConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
    );
  }
  return result.data;
}

function isEnoent(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    (value as { code?: unknown }).code === 'ENOENT'
  );
}
