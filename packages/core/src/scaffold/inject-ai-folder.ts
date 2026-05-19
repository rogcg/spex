import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TechSpec } from '@spex/schemas';
import { techSpecToYaml } from '../tech-spec/writer.js';

const AI_FOLDER_README = `# .ai/

This directory contains SPEX-managed artifacts.

- \`tech-spec.yaml\` — architectural decisions and rationale
- Future SPEX commands will add: agents/, workflows/, specs/
`;

export interface InjectAiFolderOptions {
  projectDir: string;
  spec: TechSpec;
}

export async function injectAiFolder(options: InjectAiFolderOptions): Promise<void> {
  const aiDir = join(options.projectDir, '.ai');
  await mkdir(aiDir, { recursive: true });
  await writeFile(join(aiDir, 'tech-spec.yaml'), techSpecToYaml(options.spec), 'utf8');
  await writeFile(join(aiDir, 'README.md'), AI_FOLDER_README, 'utf8');
}
