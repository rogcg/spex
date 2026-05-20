import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ApprovalConfig,
  type ApprovalStoreOptions,
  computeApprovalOutcome,
  createPendingApproval,
  deleteApproval,
  expirePendingApprovals,
  listApprovals,
  loadApproval,
  recordDecision,
} from './approvals.js';

async function makeTempProject(): Promise<ApprovalStoreOptions> {
  const dir = await mkdtemp(join(tmpdir(), 'spex-slack-approvals-'));
  return { projectDir: dir };
}

describe('createPendingApproval + loadApproval', () => {
  it('persists a record with a correlation id, expiry, and decisions array', async () => {
    const options = await makeTempProject();
    const config: ApprovalConfig = {
      approvers: ['U1', 'U2'],
      mode: 'any_of',
      timeoutHours: 24,
    };
    const record = await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 'NullPointerException in checkout',
        payload: { posthogIssueId: 'iss_abc' },
        config,
        slack: { channelId: 'C123', ts: '1716.000' },
      },
      options,
    );
    expect(record.correlationId).toMatch(/^spex-approval-[0-9a-f]+$/);
    expect(record.status).toBe('pending');
    expect(record.decisions).toEqual([]);
    expect(Date.parse(record.expiresAt)).toBeGreaterThan(Date.parse(record.createdAt));
    const loaded = await loadApproval(record.correlationId, options);
    expect(loaded).not.toBeNull();
    expect(loaded?.workflow.payload).toEqual({ posthogIssueId: 'iss_abc' });
  });

  it('writes the file with 0o600 permissions on POSIX (sanity check, skipped on Windows)', async () => {
    if (process.platform === 'win32') return;
    const options = await makeTempProject();
    const record = await createPendingApproval(
      {
        kind: 'spec_generated',
        title: 't',
        payload: {},
        config: { approvers: ['U1'], mode: 'any_of' },
        slack: { channelId: 'C', ts: '1' },
      },
      options,
    );
    const path = join(options.projectDir, '.ai/scratch/approvals', `${record.correlationId}.json`);
    const { stat } = await import('node:fs/promises');
    const s = await stat(path);
    expect(s.mode & 0o777).toBe(0o600);
  });
});

describe('recordDecision — any_of mode', () => {
  it('approves on the first Approve click', async () => {
    const options = await makeTempProject();
    const record = await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 't',
        payload: {},
        config: { approvers: ['U1', 'U2'], mode: 'any_of' },
        slack: { channelId: 'C', ts: '1' },
      },
      options,
    );
    const result = await recordDecision({
      correlationId: record.correlationId,
      userId: 'U1',
      decision: 'approve',
      options,
    });
    expect(result.kind).toBe('recorded');
    if (result.kind === 'recorded') {
      expect(result.record.status).toBe('approved');
      expect(result.record.finalisedAt).toBeDefined();
    }
  });

  it('rejects when the first decision is a Reject', async () => {
    const options = await makeTempProject();
    const record = await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 't',
        payload: {},
        config: { approvers: ['U1', 'U2'], mode: 'any_of' },
        slack: { channelId: 'C', ts: '1' },
      },
      options,
    );
    const result = await recordDecision({
      correlationId: record.correlationId,
      userId: 'U1',
      decision: 'reject',
      options,
    });
    expect(result.kind).toBe('recorded');
    if (result.kind === 'recorded') expect(result.record.status).toBe('rejected');
  });

  it('refuses decisions from non-approvers', async () => {
    const options = await makeTempProject();
    const record = await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 't',
        payload: {},
        config: { approvers: ['U1'], mode: 'any_of' },
        slack: { channelId: 'C', ts: '1' },
      },
      options,
    );
    const result = await recordDecision({
      correlationId: record.correlationId,
      userId: 'U99',
      decision: 'approve',
      options,
    });
    expect(result.kind).toBe('not_approver');
  });

  it('rejects duplicate clicks from the same user', async () => {
    const options = await makeTempProject();
    const record = await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 't',
        payload: {},
        config: { approvers: ['U1', 'U2'], mode: 'all_of' },
        slack: { channelId: 'C', ts: '1' },
      },
      options,
    );
    await recordDecision({
      correlationId: record.correlationId,
      userId: 'U1',
      decision: 'approve',
      options,
    });
    const second = await recordDecision({
      correlationId: record.correlationId,
      userId: 'U1',
      decision: 'approve',
      options,
    });
    expect(second.kind).toBe('duplicate');
  });

  it('returns already_finalised when the approval has resolved', async () => {
    const options = await makeTempProject();
    const record = await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 't',
        payload: {},
        config: { approvers: ['U1'], mode: 'any_of' },
        slack: { channelId: 'C', ts: '1' },
      },
      options,
    );
    await recordDecision({
      correlationId: record.correlationId,
      userId: 'U1',
      decision: 'approve',
      options,
    });
    const second = await recordDecision({
      correlationId: record.correlationId,
      userId: 'U1',
      decision: 'reject',
      options,
    });
    expect(second.kind).toBe('already_finalised');
  });
});

describe('recordDecision — all_of mode', () => {
  it('waits for every approver before flipping to approved', async () => {
    const options = await makeTempProject();
    const record = await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 't',
        payload: {},
        config: { approvers: ['U1', 'U2', 'U3'], mode: 'all_of' },
        slack: { channelId: 'C', ts: '1' },
      },
      options,
    );
    const r1 = await recordDecision({
      correlationId: record.correlationId,
      userId: 'U1',
      decision: 'approve',
      options,
    });
    expect(r1.kind === 'recorded' && r1.record.status).toBe('pending');
    const r2 = await recordDecision({
      correlationId: record.correlationId,
      userId: 'U2',
      decision: 'approve',
      options,
    });
    expect(r2.kind === 'recorded' && r2.record.status).toBe('pending');
    const r3 = await recordDecision({
      correlationId: record.correlationId,
      userId: 'U3',
      decision: 'approve',
      options,
    });
    expect(r3.kind === 'recorded' && r3.record.status).toBe('approved');
  });

  it('flips to rejected as soon as one approver rejects', async () => {
    const options = await makeTempProject();
    const record = await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 't',
        payload: {},
        config: { approvers: ['U1', 'U2'], mode: 'all_of' },
        slack: { channelId: 'C', ts: '1' },
      },
      options,
    );
    const r1 = await recordDecision({
      correlationId: record.correlationId,
      userId: 'U1',
      decision: 'approve',
      options,
    });
    expect(r1.kind === 'recorded' && r1.record.status).toBe('pending');
    const r2 = await recordDecision({
      correlationId: record.correlationId,
      userId: 'U2',
      decision: 'reject',
      options,
    });
    expect(r2.kind === 'recorded' && r2.record.status).toBe('rejected');
  });
});

describe('recordDecision — quorum mode', () => {
  it('flips to approved once the quorum is reached', async () => {
    const options = await makeTempProject();
    const record = await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 't',
        payload: {},
        config: { approvers: ['U1', 'U2', 'U3', 'U4'], mode: 'quorum', quorum: 2 },
        slack: { channelId: 'C', ts: '1' },
      },
      options,
    );
    await recordDecision({
      correlationId: record.correlationId,
      userId: 'U1',
      decision: 'approve',
      options,
    });
    const second = await recordDecision({
      correlationId: record.correlationId,
      userId: 'U2',
      decision: 'approve',
      options,
    });
    expect(second.kind === 'recorded' && second.record.status).toBe('approved');
  });

  it('rejects when the remaining approvers cannot reach quorum', async () => {
    const options = await makeTempProject();
    const record = await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 't',
        payload: {},
        config: { approvers: ['U1', 'U2', 'U3'], mode: 'quorum', quorum: 3 },
        slack: { channelId: 'C', ts: '1' },
      },
      options,
    );
    const r1 = await recordDecision({
      correlationId: record.correlationId,
      userId: 'U1',
      decision: 'reject',
      options,
    });
    // Only 2 approvers remain → cannot satisfy quorum of 3 → final reject.
    expect(r1.kind === 'recorded' && r1.record.status).toBe('rejected');
  });
});

describe('expiry handling', () => {
  it('marks an approval expired when the deadline passes before any decision', async () => {
    const projectDir = (await makeTempProject()).projectDir;
    let clock = new Date('2026-05-19T12:00:00Z');
    const options: ApprovalStoreOptions = { projectDir, now: () => clock };
    const record = await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 't',
        payload: {},
        config: { approvers: ['U1'], mode: 'any_of', timeoutHours: 1 },
        slack: { channelId: 'C', ts: '1' },
      },
      options,
    );
    clock = new Date('2026-05-19T13:30:00Z'); // 1.5h later
    const result = await recordDecision({
      correlationId: record.correlationId,
      userId: 'U1',
      decision: 'approve',
      options,
    });
    expect(result.kind).toBe('expired');
  });

  it('expirePendingApprovals sweeps stale pending records', async () => {
    const projectDir = (await makeTempProject()).projectDir;
    let clock = new Date('2026-05-19T12:00:00Z');
    const options: ApprovalStoreOptions = { projectDir, now: () => clock };
    const record = await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 't',
        payload: {},
        config: { approvers: ['U1'], mode: 'any_of', timeoutHours: 1 },
        slack: { channelId: 'C', ts: '1' },
      },
      options,
    );
    clock = new Date('2026-05-19T14:00:00Z');
    const expired = await expirePendingApprovals(options);
    expect(expired).toHaveLength(1);
    expect(expired[0]?.correlationId).toBe(record.correlationId);
    const loaded = await loadApproval(record.correlationId, options);
    expect(loaded?.status).toBe('expired');
  });
});

describe('listApprovals', () => {
  it('returns records sorted oldest-first and filters by status', async () => {
    const options = await makeTempProject();
    let clock = new Date('2026-05-19T12:00:00Z');
    const localOpts: ApprovalStoreOptions = { ...options, now: () => clock };
    await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 'first',
        payload: {},
        config: { approvers: ['U1'], mode: 'any_of' },
        slack: { channelId: 'C', ts: '1' },
      },
      localOpts,
    );
    clock = new Date('2026-05-19T12:01:00Z');
    const second = await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 'second',
        payload: {},
        config: { approvers: ['U1'], mode: 'any_of' },
        slack: { channelId: 'C', ts: '2' },
      },
      localOpts,
    );
    await recordDecision({
      correlationId: second.correlationId,
      userId: 'U1',
      decision: 'approve',
      options: localOpts,
    });
    const allPending = await listApprovals({ ...options, statusFilter: 'pending' });
    expect(allPending).toHaveLength(1);
    expect(allPending[0]?.workflow.title).toBe('first');
    const all = await listApprovals(options);
    expect(all).toHaveLength(2);
    expect(all[0]?.workflow.title).toBe('first');
    expect(all[1]?.workflow.title).toBe('second');
  });
});

describe('deleteApproval', () => {
  it('removes the file and returns true', async () => {
    const options = await makeTempProject();
    const record = await createPendingApproval(
      {
        kind: 'fix_proposed',
        title: 't',
        payload: {},
        config: { approvers: ['U1'], mode: 'any_of' },
        slack: { channelId: 'C', ts: '1' },
      },
      options,
    );
    const deleted = await deleteApproval(record.correlationId, options);
    expect(deleted).toBe(true);
    expect(await loadApproval(record.correlationId, options)).toBeNull();
    const again = await deleteApproval(record.correlationId, options);
    expect(again).toBe(false);
  });
});

describe('computeApprovalOutcome', () => {
  it('preserves an already-finalised outcome', () => {
    const outcome = computeApprovalOutcome({
      v: 1,
      correlationId: 'spex-approval-1',
      createdAt: '2026-05-19T12:00:00Z',
      expiresAt: '2026-05-20T12:00:00Z',
      status: 'approved',
      finalisedAt: '2026-05-19T12:05:00Z',
      config: { approvers: ['U1'], mode: 'any_of' },
      workflow: { kind: 'fix_proposed', title: 't', payload: {} },
      slack: { channelId: 'C', ts: '1' },
      decisions: [{ userId: 'U1', decision: 'approve', at: '2026-05-19T12:05:00Z' }],
    });
    expect(outcome).toBe('approved');
  });
});

afterEach(() => {
  // Each test creates its own tmpdir; nothing global to clean up. Kept for
  // future hooks if any global state sneaks in.
});
