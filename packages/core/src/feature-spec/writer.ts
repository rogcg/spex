import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FeatureSpec } from '@spex/schemas';
import { stringify as stringifyYaml } from 'yaml';

export function featureSpecToYaml(spec: FeatureSpec): string {
  return stringifyYaml(spec, { indent: 2, lineWidth: 0 });
}

export interface WriteFeatureSpecOptions {
  projectDir: string;
  spec: FeatureSpec;
}

export interface WriteFeatureSpecResult {
  absolutePath: string;
  relativePath: string;
}

export async function writeFeatureSpec(
  options: WriteFeatureSpecOptions,
): Promise<WriteFeatureSpecResult> {
  const specsDir = join(options.projectDir, '.ai', 'specs');
  await mkdir(specsDir, { recursive: true });
  const fileName = `${options.spec.feature.slug}.yaml`;
  const absolutePath = join(specsDir, fileName);
  await writeFile(absolutePath, featureSpecToYaml(options.spec), 'utf8');
  return {
    absolutePath,
    relativePath: join('.ai', 'specs', fileName),
  };
}
