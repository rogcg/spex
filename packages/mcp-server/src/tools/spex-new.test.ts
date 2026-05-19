import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider } from '@spex/core';
import type { TechSpec } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { spexNewToolDefinition } from './spex-new.js';

const sampleSpec: TechSpec = {
  version: 1,
  project: { name: 'demo-app', type: 'web-app', description: 'A demo project' },
  context: {
    primary_users: 'Internal team',
    expected_scale: 'Less than 100 users',
    auth_requirements: 'None',
    data_persistence: 'Simple key-value',
  },
  stack: {
    language: 'typescript',
    frontend: { framework: 'nextjs', version: '15', styling: 'tailwindcss', app_router: true },
  },
  scaffolding_plan: {
    commands: [
      'pnpm create next-app@latest demo-app --typescript --tailwind --app --src-dir --import-alias "@/*" --use-pnpm',
    ],
  },
  rationale: 'Next.js App Router with Tailwind for a small internal tool — straightforward DX.',
};

let parentDir: string;

beforeEach(async () => {
  parentDir = await mkdtemp(join(tmpdir(), 'spex-mcp-new-'));
});
afterEach(async () => {
  await rm(parentDir, { recursive: true, force: true });
});

describe('spexNewToolDefinition', () => {
  it('advertises spex_new with the required input fields', () => {
    expect(spexNewToolDefinition.tool.name).toBe('spex_new');
    const schema = spexNewToolDefinition.tool.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.required).toEqual(['name', 'project_type']);
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining([
        'name',
        'project_type',
        'primary_users',
        'expected_scale',
        'auth_requirements',
        'data_persistence',
        'parent_dir',
      ]),
    );
  });

  it('rejects invalid input with isError=true', async () => {
    const result = await spexNewToolDefinition.handle(
      { name: 'NotValid', project_type: 'tool' },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseTextPayload(result.content?.[0]);
    expect(payload.status).toBe('error');
    expect(payload.message).toContain('Invalid input');
  });

  it('rejects when the target directory already exists', async () => {
    await mkdir(join(parentDir, 'demo-app'), { recursive: true });
    const result = await spexNewToolDefinition.handle(
      { name: 'demo-app', project_type: 'tool', parent_dir: parentDir },
      { llm: stubLlm(sampleSpec), scaffold: vi.fn() },
    );
    expect(result.isError).toBe(true);
    expect(parseTextPayload(result.content?.[0]).message).toContain('already exists');
  });

  it('runs LLM tech-spec generation, calls the scaffold stub, and writes the .ai/ folder', async () => {
    const scaffold = vi.fn().mockImplementation(async (opts) => {
      // Simulate what create-next-app would produce: at minimum the project dir.
      await mkdir(join(opts.parentDir, opts.projectName), { recursive: true });
      await writeFile(
        join(opts.parentDir, opts.projectName, 'package.json'),
        JSON.stringify({ name: opts.projectName }),
        'utf8',
      );
    });
    const llm = stubLlm(sampleSpec);

    const result = await spexNewToolDefinition.handle(
      {
        name: 'demo-app',
        project_type: 'internal admin tool',
        primary_users: 'Internal team',
        expected_scale: 'Less than 100 users',
        auth_requirements: 'OAuth (Google, GitHub, etc.)',
        data_persistence: 'Relational database',
        parent_dir: parentDir,
      },
      { llm, scaffold },
    );

    expect(result.isError).toBeFalsy();
    const payload = parseTextPayload(result.content?.[0]);
    expect(payload.status).toBe('success');
    expect(payload.projectDir).toBe(join(parentDir, 'demo-app'));
    expect(payload.filesCreated).toEqual(['.ai/tech-spec.yaml', '.ai/README.md']);

    expect(scaffold).toHaveBeenCalledTimes(1);
    expect(scaffold).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'demo-app', parentDir, stdio: 'pipe' }),
    );

    // .ai/ files exist with the spec the LLM produced
    const yaml = await readFile(join(parentDir, 'demo-app', '.ai', 'tech-spec.yaml'), 'utf8');
    expect(parseYaml(yaml)).toEqual(sampleSpec);
  });

  it('surfaces LLM errors as isError', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockRejectedValue(new Error('llm down')),
    };
    const result = await spexNewToolDefinition.handle(
      { name: 'demo-app', project_type: 'tool', parent_dir: parentDir },
      { llm, scaffold: vi.fn() },
    );
    expect(result.isError).toBe(true);
    expect(parseTextPayload(result.content?.[0]).message).toContain('Tech-spec generation failed');
  });
});

function stubLlm(spec: TechSpec): LLMProvider {
  return {
    generateStructured: vi.fn().mockResolvedValue(spec),
  };
}

function parseTextPayload(content: unknown): {
  status: string;
  message?: string;
  [k: string]: unknown;
} {
  if (!content || typeof content !== 'object') throw new Error('no content');
  const text = (content as { text?: unknown }).text;
  if (typeof text !== 'string') throw new Error('content has no text');
  return JSON.parse(text);
}
