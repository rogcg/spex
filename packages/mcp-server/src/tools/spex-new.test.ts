import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider, RunScaffoldOptions, RunScaffoldResult } from '@spex/core';
import type { ScaffoldPlan, StackRecommendations, TechSpec } from '@spex/schemas';
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
    label: 'Next.js 15 App Router + Tailwind',
    source: 'recommended',
    components: [
      { role: 'framework', choice: 'Next.js 15 App Router', rationale: 'Web app' },
      { role: 'styling', choice: 'Tailwind CSS', rationale: 'Styling' },
    ],
    tradeoffs: [],
    validation_warnings: [],
  },
  rationale: 'Next.js App Router with Tailwind for a small internal tool — straightforward DX.',
};

const sampleRecommendations: StackRecommendations = {
  recommendations: [
    {
      rank: 1,
      label: 'Next.js 15 App Router + Tailwind',
      components: [
        { role: 'framework', choice: 'Next.js 15 App Router', rationale: 'SSR web app' },
        { role: 'styling', choice: 'Tailwind CSS', rationale: 'Rapid styling' },
      ],
      tradeoffs: [],
      confidence: 'high',
      requirementsCovered: ['internal tool', 'OAuth'],
      requirementsUnaddressed: [],
    },
  ],
  unmappedRequirements: [],
};

const samplePlan: ScaffoldPlan = {
  stackLabel: sampleSpec.stack.label,
  steps: [
    {
      kind: 'command',
      cmd: 'pnpm',
      args: ['create', 'next-app@latest', 'demo-app'],
      rationale: 'scaffold',
    },
  ],
  postConditions: ['package.json exists'],
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
        'stack',
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
      { llm: stubLlm([sampleRecommendations, sampleSpec]), scaffold: vi.fn() },
    );
    expect(result.isError).toBe(true);
    expect(parseTextPayload(result.content?.[0]).message).toContain('already exists');
  });

  it('runs LLM stack recommendation + tech-spec generation, calls runScaffold, and writes the .ai/ folder', async () => {
    const scaffold = vi
      .fn()
      .mockImplementation(async (opts: RunScaffoldOptions): Promise<RunScaffoldResult> => {
        await mkdir(opts.projectDir, { recursive: true });
        await writeFile(
          join(opts.projectDir, 'package.json'),
          JSON.stringify({ name: opts.projectName }),
          'utf8',
        );
        return {
          ok: true,
          plan: samplePlan,
          attempts: [
            {
              attempt: 1,
              plan: samplePlan,
              appliedSteps: 1,
              verification: { ok: true, failedPostConditions: [], notes: '' },
              commandFailure: null,
            },
          ],
        };
      });
    const llm = stubLlm([sampleRecommendations, sampleSpec]);

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
      expect.objectContaining({ projectName: 'demo-app', parentDir }),
    );

    const yaml = await readFile(join(parentDir, 'demo-app', '.ai', 'tech-spec.yaml'), 'utf8');
    expect(parseYaml(yaml)).toEqual(sampleSpec);
  });

  it('honors an explicit `stack` input by tagging the decision source as user-chosen', async () => {
    const scaffold = vi
      .fn()
      .mockImplementation(async (opts: RunScaffoldOptions): Promise<RunScaffoldResult> => {
        await mkdir(opts.projectDir, { recursive: true });
        return {
          ok: true,
          plan: samplePlan,
          attempts: [
            {
              attempt: 1,
              plan: samplePlan,
              appliedSteps: 1,
              verification: { ok: true, failedPostConditions: [], notes: '' },
              commandFailure: null,
            },
          ],
        };
      });
    const llm = stubLlm([sampleRecommendations, sampleSpec]);

    await spexNewToolDefinition.handle(
      {
        name: 'demo-app',
        project_type: 'internal admin tool',
        stack: 'SvelteKit + Drizzle + Turso',
        parent_dir: parentDir,
      },
      { llm, scaffold },
    );

    const scaffoldCall = scaffold.mock.calls[0]?.[0] as RunScaffoldOptions;
    expect(scaffoldCall.decision.source).toBe('user');
    expect(scaffoldCall.decision.rationale).toContain('SvelteKit + Drizzle + Turso');
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
    expect(parseTextPayload(result.content?.[0]).message).toContain('Stack selection failed');
  });
});

function stubLlm(responses: unknown[]): LLMProvider {
  let i = 0;
  return {
    generateStructured: vi.fn(async () => {
      const next = responses[i++];
      if (next === undefined) throw new Error('stub LLM exhausted');
      return next as never;
    }),
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
