import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateStore } from '@spex/core';
import type { ScratchState } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spexResumeToolDefinition } from './spex-resume.js';

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'spex-mcp-resume-'));
});
afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

function state(overrides: Partial<ScratchState> = {}): ScratchState {
  return {
    version: 1,
    workflowId: 'wf-default',
    kind: 'implementation',
    status: 'paused',
    createdAt: '2026-05-20T10:00:00.000Z',
    updatedAt: '2026-05-20T10:05:00.000Z',
    lastActivityAt: '2026-05-20T10:05:00.000Z',
    ...overrides,
  };
}

function extractJson(result: { content: readonly unknown[] }): unknown {
  const first = result.content[0];
  if (!first || typeof first !== 'object') throw new Error('no content');
  const text = (first as { text?: unknown }).text;
  if (typeof text !== 'string') throw new Error('content has no text');
  return JSON.parse(text);
}

describe('spexResumeToolDefinition', () => {
  it('list=true returns the full workflow list', async () => {
    const store = createStateStore({ projectDir });
    await store.save(state({ workflowId: 'wf-1' }));
    await store.save(state({ workflowId: 'wf-2', kind: 'fix' }));
    const result = await spexResumeToolDefinition.handle(
      { project_dir: projectDir, list: true },
      {},
    );
    const parsed = extractJson(result) as {
      status: string;
      workflows: { workflowId: string }[];
    };
    expect(parsed.status).toBe('success');
    expect(parsed.workflows.map((w) => w.workflowId).sort()).toEqual(['wf-1', 'wf-2']);
  });

  it('returns resumable subset by default', async () => {
    const store = createStateStore({ projectDir });
    await store.save(state({ workflowId: 'wf-paused', status: 'paused' }));
    await store.save(state({ workflowId: 'wf-done', status: 'completed' }));
    const result = await spexResumeToolDefinition.handle({ project_dir: projectDir }, {});
    const parsed = extractJson(result) as {
      resumable?: { workflowId: string }[];
      workflows?: { workflowId: string }[];
    };
    expect(parsed.resumable?.map((w) => w.workflowId)).toEqual(['wf-paused']);
  });

  it('abandons a workflow when abandon: <id> is passed', async () => {
    const store = createStateStore({ projectDir });
    await store.save(state({ workflowId: 'wf-1' }));
    const result = await spexResumeToolDefinition.handle(
      { project_dir: projectDir, abandon: 'wf-1' },
      {},
    );
    const parsed = extractJson(result) as { status: string; abandoned: string };
    expect(parsed.abandoned).toBe('wf-1');
    expect(await store.load('wf-1')).toBeNull();
  });

  it('returns an error when the requested workflow does not exist', async () => {
    const result = await spexResumeToolDefinition.handle(
      { project_dir: projectDir, workflow_id: 'nope' },
      {},
    );
    expect(result.isError).toBe(true);
  });
});
