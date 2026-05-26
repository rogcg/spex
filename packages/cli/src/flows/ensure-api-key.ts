import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { password } from '@inquirer/prompts';
import { ensureEnvGitignored, upsertEnvVar } from '../env-file.js';
import { STRINGS } from '../strings.js';

const API_KEY_PREFIX = 'sk-ant-';

export async function promptForAnthropicApiKey(): Promise<string> {
  const raw = await password({
    message: STRINGS.apiKey.promptMessage,
    mask: '*',
    validate: (input) => {
      const trimmed = input.trim();
      if (trimmed.length === 0) return STRINGS.apiKey.validationEmpty;
      if (!trimmed.startsWith(API_KEY_PREFIX)) return STRINGS.apiKey.validationFormat;
      return true;
    },
  });
  return raw.trim();
}

/**
 * Save the key into `<projectDir>/.env` (creating or updating the file) and
 * make sure `.env` is gitignored. No-op if the project directory does not
 * exist yet — caller is responsible for sequencing this after scaffold.
 */
export function persistAnthropicApiKey(opts: { projectDir: string; key: string }): string | null {
  if (!existsSync(opts.projectDir)) return null;
  upsertEnvVar(opts.projectDir, 'ANTHROPIC_API_KEY', opts.key);
  ensureEnvGitignored(opts.projectDir);
  return join(opts.projectDir, '.env');
}
