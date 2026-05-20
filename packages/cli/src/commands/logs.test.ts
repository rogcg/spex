import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuditLogger } from '@spex/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDuration, runLogsCommand } from './logs.js';

let projectDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'spex-logs-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(async () => {
  logSpy.mockRestore();
  await rm(projectDir, { recursive: true, force: true });
});

describe('parseDuration', () => {
  it('parses common durations', () => {
    expect(parseDuration('30s')).toBe(30 * 1000);
    expect(parseDuration('5m')).toBe(5 * 60 * 1000);
    expect(parseDuration('2h')).toBe(2 * 60 * 60 * 1000);
    expect(parseDuration('3d')).toBe(3 * 24 * 60 * 60 * 1000);
    expect(parseDuration('1w')).toBe(7 * 24 * 60 * 60 * 1000);
  });
  it('rejects malformed values', () => {
    expect(() => parseDuration('abc')).toThrow();
    expect(() => parseDuration('10x')).toThrow();
    expect(() => parseDuration('')).toThrow();
  });
});

describe('runLogsCommand', () => {
  async function seed() {
    const logger = createAuditLogger({
      projectDir,
      now: () => new Date('2026-05-20T10:00:00.000Z'),
    });
    await logger.log({
      workflowId: 'wf-1',
      type: 'llm_call',
      actor: 'agent',
      payload: { model: 'claude' },
    });
    await logger.log({
      workflowId: 'wf-1',
      type: 'file_write',
      actor: 'agent',
      payload: { path: 'foo.ts' },
    });
    await logger.log({
      workflowId: 'wf-2',
      type: 'decision',
      actor: 'user',
      payload: { id: 'stack' },
    });
    return logger;
  }

  it('filters by workflow', async () => {
    await seed();
    await runLogsCommand({ projectDir, workflowId: 'wf-2', format: 'json' });
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('"workflowId": "wf-2"');
    expect(out).not.toContain('"workflowId": "wf-1"');
  });

  it('filters by type and actor (AND semantics)', async () => {
    await seed();
    await runLogsCommand({
      projectDir,
      type: 'llm_call',
      actor: 'agent',
      format: 'json',
    });
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('"type": "llm_call"');
    expect(out).not.toContain('"type": "decision"');
    expect(out).not.toContain('"type": "file_write"');
  });

  it('summary format reports counts by type', async () => {
    await seed();
    await runLogsCommand({ projectDir, format: 'summary' });
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('llm_call: 1');
    expect(out).toContain('decision: 1');
    expect(out).toContain('file_write: 1');
  });

  it('rejects invalid filter values', async () => {
    await seed();
    await expect(runLogsCommand({ projectDir, type: 'bogus' })).rejects.toThrow();
    await expect(runLogsCommand({ projectDir, actor: 'cat' })).rejects.toThrow();
    await expect(runLogsCommand({ projectDir, format: 'csv' })).rejects.toThrow();
  });

  it('--export writes the filtered events to a file', async () => {
    await seed();
    const exportPath = join(projectDir, 'out.json');
    await runLogsCommand({
      projectDir,
      type: 'llm_call',
      export: exportPath,
      format: 'json',
    });
    const raw = await readFile(exportPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('llm_call');
  });

  it('--since filters out events older than the duration', async () => {
    const logger = createAuditLogger({
      projectDir,
      now: () => new Date('2026-05-20T09:00:00.000Z'),
    });
    await logger.log({
      workflowId: 'wf-old',
      type: 'llm_call',
      actor: 'agent',
      payload: {},
    });
    const logger2 = createAuditLogger({
      projectDir,
      now: () => new Date('2026-05-20T10:30:00.000Z'),
    });
    await logger2.log({
      workflowId: 'wf-new',
      type: 'llm_call',
      actor: 'agent',
      payload: {},
    });
    await runLogsCommand({
      projectDir,
      since: '1h',
      format: 'json',
      nowOverride: () => new Date('2026-05-20T11:00:00.000Z'),
    });
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('wf-new');
    expect(out).not.toContain('wf-old');
  });
});
