import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TechSpec } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { injectAiFolder } from './inject-ai-folder.js';

const spec: TechSpec = {
  version: 1,
  project: {
    name: 'demo',
    type: 'web-app',
    description: 'A demo project',
  },
  context: {
    primary_users: 'Developers',
    expected_scale: 'Less than 100 users',
    auth_requirements: 'None',
    data_persistence: 'Simple key-value',
  },
  stack: {
    label: 'Next.js 15 App Router + Tailwind',
    source: 'recommended',
    components: [
      { role: 'framework', choice: 'Next.js 15 App Router', rationale: 'SSR web app' },
      { role: 'styling', choice: 'Tailwind CSS', rationale: 'Rapid styling' },
    ],
    tradeoffs: [],
    validation_warnings: [],
  },
  rationale:
    'Next.js with App Router gives us streaming SSR and a strong DX for this developer-facing tool.',
};

describe('injectAiFolder', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-scaffold-'));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('creates a .ai/ directory inside the project', async () => {
    await injectAiFolder({ projectDir, spec });
    const stats = await stat(join(projectDir, '.ai'));
    expect(stats.isDirectory()).toBe(true);
  });

  it('writes .ai/tech-spec.yaml with a YAML representation that parses back to the spec', async () => {
    await injectAiFolder({ projectDir, spec });
    const yaml = await readFile(join(projectDir, '.ai', 'tech-spec.yaml'), 'utf8');
    expect(yaml).toContain('version: 1');
    expect(yaml).toContain('name: demo');
    expect(parseYaml(yaml)).toEqual(spec);
  });

  it('writes .ai/README.md with the standard placeholder content', async () => {
    await injectAiFolder({ projectDir, spec });
    const readme = await readFile(join(projectDir, '.ai', 'README.md'), 'utf8');
    expect(readme).toContain('# .ai/');
    expect(readme).toContain('tech-spec.yaml');
    expect(readme).toContain('SPEX-managed artifacts');
  });

  it('creates the .ai/ directory even if it does not already exist (mkdir recursive)', async () => {
    const nested = join(projectDir, 'nested', 'project');
    await injectAiFolder({ projectDir: nested, spec });
    // mkdir was called with recursive — nested intermediate dirs created
    // Verify we can read the file
    const yaml = await readFile(join(nested, '.ai', 'tech-spec.yaml'), 'utf8');
    expect(yaml.length).toBeGreaterThan(0);
  });
});
