import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuditLogger } from './logger.js';
import { createAuditReader } from './reader.js';

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'spex-audit-'));
});
afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('createAuditLogger', () => {
  it('writes JSONL to both global + workflow files', async () => {
    const logger = createAuditLogger({ projectDir });
    await logger.log({
      workflowId: 'wf-1',
      type: 'file_write',
      actor: 'agent',
      payload: { path: 'src/foo.ts', bytes: 42 },
    });
    await logger.log({
      workflowId: 'wf-1',
      type: 'decision',
      actor: 'user',
      payload: { id: 'project-type', status: 'accepted' },
    });
    const global = (await readFile(logger.globalPath(), 'utf8')).trim().split('\n');
    const wf = (await readFile(logger.workflowPath('wf-1'), 'utf8')).trim().split('\n');
    expect(global).toHaveLength(2);
    expect(wf).toHaveLength(2);
  });

  it('redacts secrets in payload values', async () => {
    const logger = createAuditLogger({ projectDir });
    await logger.log({
      workflowId: 'wf-1',
      type: 'llm_call',
      actor: 'agent',
      payload: {
        api_key: 'sk-ant-supersecret-1234567890abcdef',
        prompt: 'use token sk-ant-leaky-key-12345 to log in',
      },
    });
    const raw = await readFile(logger.globalPath(), 'utf8');
    expect(raw).not.toContain('supersecret');
    expect(raw).not.toContain('leaky-key');
    expect(raw).toContain('[REDACTED]');
  });

  it('rejects invalid events at the schema boundary', async () => {
    const logger = createAuditLogger({ projectDir });
    await expect(
      logger.log({
        workflowId: 'wf-1',
        // @ts-expect-error -- exercising the runtime guard
        type: 'not-a-real-type',
        actor: 'agent',
        payload: {},
      }),
    ).rejects.toThrow();
  });

  it('reader reads back the events written by the logger', async () => {
    const logger = createAuditLogger({ projectDir });
    await logger.log({
      workflowId: 'wf-1',
      type: 'state_transition',
      actor: 'system',
      payload: { from: 'running', to: 'paused' },
    });
    const reader = createAuditReader({ projectDir });
    const events = await reader.read({ workflowId: 'wf-1' });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('state_transition');
  });

  it('reader skips malformed JSONL lines', async () => {
    const logger = createAuditLogger({ projectDir });
    await logger.log({
      workflowId: 'wf-1',
      type: 'state_transition',
      actor: 'system',
      payload: { ok: true },
    });
    const { appendFile } = await import('node:fs/promises');
    await appendFile(logger.globalPath(), 'not-json-at-all\n', 'utf8');
    const reader = createAuditReader({ projectDir });
    const events = await reader.read();
    expect(events).toHaveLength(1);
  });
});
