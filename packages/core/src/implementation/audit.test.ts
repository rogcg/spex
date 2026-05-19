import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAuditLog } from './audit.js';

let projectDir: string;

describe('openAuditLog', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-audit-'));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('creates .ai/audit/ and writes a stamped jsonl file under it', async () => {
    const now = () => new Date('2026-05-17T18:22:09.123Z');
    const log = await openAuditLog({ projectDir, featureSlug: 'add-pagination', now });
    expect(log.path).toMatch(/\.ai\/audit\/2026-05-17T18-22-09-123Z-add-pagination\.jsonl$/);
    const entries = await readdir(join(projectDir, '.ai', 'audit'));
    expect(entries.length).toBe(1);
  });

  it('appends JSONL-formatted entries (one JSON object per line)', async () => {
    const log = await openAuditLog({
      projectDir,
      featureSlug: 'add-x',
      now: () => new Date('2026-05-17T18:22:09.123Z'),
    });
    await log.append({
      type: 'run-start',
      timestamp: '2026-05-17T18:22:09.123Z',
      feature_slug: 'add-x',
      mode: 'auto',
      operation_count: 2,
    });
    await log.append({
      type: 'op',
      timestamp: '2026-05-17T18:22:09.124Z',
      order: 1,
      path: 'src/x.ts',
      operation: 'create',
      outcome: 'applied',
    });
    const raw = await readFile(log.path, 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '').type).toBe('run-start');
    expect(JSON.parse(lines[1] ?? '').outcome).toBe('applied');
  });

  it('honours a custom auditDir', async () => {
    const customDir = join(projectDir, 'custom-audit');
    const log = await openAuditLog({
      projectDir,
      featureSlug: 'add-x',
      auditDir: customDir,
      now: () => new Date('2026-05-17T18:22:09.123Z'),
    });
    expect(log.path.startsWith(customDir)).toBe(true);
  });
});
