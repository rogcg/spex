import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FeatureSpec } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { featureSpecToYaml, writeFeatureSpec } from './writer.js';

let projectDir: string;

const spec: FeatureSpec = {
  version: 1,
  feature: {
    slug: 'add-pagination',
    title: 'Add pagination',
    description: 'Paginates the user list page by 25 rows.',
  },
  scope: { in: ['page query param'], out: ['infinite scroll'] },
  technical_approach:
    'Add a `page` query param to the users route and slice the dataset accordingly.',
  files_affected: [{ path: 'src/app/users/page.tsx', operation: 'modify' }],
  test_cases: ['renders page 1 by default'],
  rationale: 'Stays consistent with App Router conventions and URL-driven navigation.',
};

describe('featureSpecToYaml', () => {
  it('round-trips through YAML back to the same object', () => {
    const yaml = featureSpecToYaml(spec);
    expect(yaml).toContain('slug: add-pagination');
    expect(parseYaml(yaml)).toEqual(spec);
  });
});

describe('writeFeatureSpec', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-feature-spec-w-'));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('creates .ai/specs/ and writes <slug>.yaml inside it', async () => {
    const result = await writeFeatureSpec({ projectDir, spec });
    const stats = await stat(join(projectDir, '.ai', 'specs'));
    expect(stats.isDirectory()).toBe(true);
    expect(result.relativePath).toBe(join('.ai', 'specs', 'add-pagination.yaml'));
    expect(result.absolutePath.endsWith('add-pagination.yaml')).toBe(true);
  });

  it('serializes the spec as YAML that parses back to the original object', async () => {
    await writeFeatureSpec({ projectDir, spec });
    const raw = await readFile(join(projectDir, '.ai', 'specs', 'add-pagination.yaml'), 'utf8');
    expect(parseYaml(raw)).toEqual(spec);
  });

  it('overwrites an existing spec file with the same slug', async () => {
    await writeFeatureSpec({ projectDir, spec });
    const updated: FeatureSpec = {
      ...spec,
      feature: { ...spec.feature, description: 'Updated description for the same feature.' },
    };
    await writeFeatureSpec({ projectDir, spec: updated });
    const raw = await readFile(join(projectDir, '.ai', 'specs', 'add-pagination.yaml'), 'utf8');
    expect(parseYaml(raw)).toEqual(updated);
  });
});
