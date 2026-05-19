import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { InvalidTechSpecError, loadTechSpec } from './tech-spec-loader.js';

let projectDir: string;

const validSpec = {
  version: 1,
  project: {
    name: 'demo',
    type: 'web-app',
    description: 'A demo project',
  },
  context: {
    primary_users: 'Internal team',
    expected_scale: 'Less than 100 users',
    auth_requirements: 'None',
    data_persistence: 'Simple key-value',
  },
  stack: {
    language: 'typescript',
    frontend: {
      framework: 'nextjs',
      version: '15',
      styling: 'tailwindcss',
      app_router: true,
    },
  },
  scaffolding_plan: {
    commands: [
      'pnpm create next-app@latest demo --typescript --tailwind --app --src-dir --import-alias "@/*" --use-pnpm',
    ],
  },
  rationale:
    'Next.js with App Router provides a strong DX and supports server components for this internal tool.',
};

describe('loadTechSpec', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-context-ts-'));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('returns null when .ai/tech-spec.yaml does not exist', async () => {
    expect(await loadTechSpec(projectDir)).toBeNull();
  });

  it('parses and validates a well-formed tech-spec.yaml', async () => {
    await mkdir(join(projectDir, '.ai'), { recursive: true });
    await writeFile(join(projectDir, '.ai', 'tech-spec.yaml'), stringifyYaml(validSpec), 'utf8');
    const result = await loadTechSpec(projectDir);
    expect(result).toEqual(validSpec);
  });

  it('throws InvalidTechSpecError when YAML is malformed', async () => {
    await mkdir(join(projectDir, '.ai'), { recursive: true });
    await writeFile(join(projectDir, '.ai', 'tech-spec.yaml'), ': : : bad', 'utf8');
    await expect(loadTechSpec(projectDir)).rejects.toThrow(InvalidTechSpecError);
  });

  it('throws InvalidTechSpecError when the schema does not match', async () => {
    await mkdir(join(projectDir, '.ai'), { recursive: true });
    await writeFile(
      join(projectDir, '.ai', 'tech-spec.yaml'),
      stringifyYaml({ ...validSpec, version: 2 }),
      'utf8',
    );
    await expect(loadTechSpec(projectDir)).rejects.toThrow(InvalidTechSpecError);
  });

  it('accepts a spec with the optional inference block', async () => {
    await mkdir(join(projectDir, '.ai'), { recursive: true });
    const withInference = {
      ...validSpec,
      inference: {
        inferred: true,
        inferred_fields: ['stack.frontend.version'],
        notes: 'Detected from package.json',
      },
    };
    await writeFile(
      join(projectDir, '.ai', 'tech-spec.yaml'),
      stringifyYaml(withInference),
      'utf8',
    );
    const result = await loadTechSpec(projectDir);
    expect(result?.inference).toEqual(withInference.inference);
  });
});
