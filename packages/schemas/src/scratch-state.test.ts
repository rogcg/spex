import { describe, expect, it } from 'vitest';
import {
  AuditEventSchema,
  CheckpointSchema,
  FileSnapshotSchema,
  ScratchLockSchema,
  ScratchSessionSchema,
  ScratchStateSchema,
  WORKFLOW_ID_PATTERN,
} from './scratch-state.js';

describe('ScratchStateSchema', () => {
  const base = {
    version: 1 as const,
    workflowId: 'impl-2026-05-20-add-pagination',
    kind: 'implementation' as const,
    status: 'running' as const,
    createdAt: '2026-05-20T10:00:00.000Z',
    updatedAt: '2026-05-20T10:05:00.000Z',
    lastActivityAt: '2026-05-20T10:05:00.000Z',
  };

  it('accepts a minimal running workflow', () => {
    expect(ScratchStateSchema.parse(base)).toMatchObject({
      workflowId: 'impl-2026-05-20-add-pagination',
      status: 'running',
    });
  });

  it('rejects an invalid workflowId', () => {
    expect(() => ScratchStateSchema.parse({ ...base, workflowId: 'Bad ID' })).toThrow();
    expect(() => ScratchStateSchema.parse({ ...base, workflowId: '' })).toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() => ScratchStateSchema.parse({ ...base, status: 'maybe' })).toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() => ScratchStateSchema.parse({ ...base, kind: 'something' })).toThrow();
  });

  it('accepts an opaque payload', () => {
    const parsed = ScratchStateSchema.parse({
      ...base,
      payload: { phase: 'planning', step: 2, custom: ['a', 'b'] },
      description: 'add pagination',
      pid: 12345,
      hostname: 'host.local',
    });
    expect(parsed.payload).toEqual({ phase: 'planning', step: 2, custom: ['a', 'b'] });
    expect(parsed.pid).toBe(12345);
  });
});

describe('WORKFLOW_ID_PATTERN', () => {
  it('matches expected ids', () => {
    for (const id of ['a', 'wf1', 'impl_2026-05-20', '0abc-def']) {
      expect(WORKFLOW_ID_PATTERN.test(id)).toBe(true);
    }
  });
  it('rejects bad ids', () => {
    for (const id of ['-leading', '_under', '', 'has space', 'has/slash', 'a'.repeat(129)]) {
      expect(WORKFLOW_ID_PATTERN.test(id)).toBe(false);
    }
  });
});

describe('FileSnapshotSchema', () => {
  it('requires a 64-char lowercase hex hash', () => {
    expect(() =>
      FileSnapshotSchema.parse({
        path: 'a.ts',
        hash: 'NOTHEX'.padEnd(64, 'x'),
        size: 1,
        exists: true,
      }),
    ).toThrow();
    const good = FileSnapshotSchema.parse({
      path: 'a.ts',
      hash: 'a'.repeat(64),
      size: 1,
      exists: true,
    });
    expect(good.hash).toBe('a'.repeat(64));
  });
});

describe('CheckpointSchema', () => {
  it('defaults fileSnapshots to []', () => {
    const parsed = CheckpointSchema.parse({
      name: 'after-plan',
      createdAt: '2026-05-20T10:00:00.000Z',
    });
    expect(parsed.fileSnapshots).toEqual([]);
  });
});

describe('ScratchLockSchema', () => {
  it('requires positive pid + non-empty hostname', () => {
    expect(() =>
      ScratchLockSchema.parse({
        version: 1,
        workflowId: 'wf',
        pid: 0,
        hostname: 'h',
        acquiredAt: '2026-05-20T10:00:00.000Z',
      }),
    ).toThrow();
    expect(() =>
      ScratchLockSchema.parse({
        version: 1,
        workflowId: 'wf',
        pid: 1,
        hostname: '',
        acquiredAt: '2026-05-20T10:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('ScratchSessionSchema', () => {
  it('accepts null active workflow', () => {
    const parsed = ScratchSessionSchema.parse({
      version: 1,
      activeWorkflowId: null,
      updatedAt: '2026-05-20T10:00:00.000Z',
    });
    expect(parsed.activeWorkflowId).toBeNull();
  });
});

describe('AuditEventSchema', () => {
  it('accepts a minimal event', () => {
    const parsed = AuditEventSchema.parse({
      timestamp: '2026-05-20T10:00:00.000Z',
      workflowId: 'wf',
      type: 'llm_call',
      actor: 'agent',
      payload: { model: 'claude' },
    });
    expect(parsed.type).toBe('llm_call');
  });
  it('rejects unknown event types', () => {
    expect(() =>
      AuditEventSchema.parse({
        timestamp: '2026-05-20T10:00:00.000Z',
        workflowId: 'wf',
        type: 'unknown_event',
        actor: 'agent',
        payload: {},
      }),
    ).toThrow();
  });
  it('rejects unknown actors', () => {
    expect(() =>
      AuditEventSchema.parse({
        timestamp: '2026-05-20T10:00:00.000Z',
        workflowId: 'wf',
        type: 'llm_call',
        actor: 'cat',
        payload: {},
      }),
    ).toThrow();
  });
});
