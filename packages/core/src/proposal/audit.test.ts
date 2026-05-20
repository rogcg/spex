import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Decision } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendDecisionAuditEntry, auditLogPath, buildAuditEntry } from './audit.js';

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'project-type',
    order: 1,
    category: 'project',
    question: 'What is the project type?',
    proposal: 'SaaS web app',
    rationale: 'Discovery matches a SaaS product.',
    techSpecPath: 'project.type',
    confidence: 'high',
    status: 'accepted',
    resolvedValue: 'SaaS web app',
    ...overrides,
  };
}

describe('decision audit trail', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spex-audit-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('auditLogPath returns a fresh per-run path under .ai/audit/', () => {
    const path = auditLogPath({
      projectDir: join('projects', 'acme'),
      now: new Date('2026-05-20T10:00:00.000Z'),
    });
    expect(path).toContain(join('projects', 'acme'));
    expect(path).toContain(join('.ai', 'audit'));
    expect(path).toMatch(/decisions-2026-05-20T10-00-00-000Z\.jsonl$/);
  });

  it('appendDecisionAuditEntry writes JSONL', async () => {
    const path = join(dir, 'audit.jsonl');
    const original = makeDecision({ proposal: 'Original proposal', status: 'pending' });
    const decision = makeDecision({
      proposal: 'Revised proposal',
      resolvedValue: 'Revised proposal',
      status: 'modified',
      userNote: 'too vague',
    });
    await appendDecisionAuditEntry(path, buildAuditEntry({ decision, original }));
    await appendDecisionAuditEntry(
      path,
      buildAuditEntry({
        decision: makeDecision({
          id: 'rationale-overall',
          order: 2,
          category: 'rationale',
          techSpecPath: 'rationale',
        }),
        original: makeDecision({
          id: 'rationale-overall',
          order: 2,
          category: 'rationale',
          techSpecPath: 'rationale',
          status: 'pending',
        }),
      }),
    );
    const raw = await readFile(path, 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? '{}');
    expect(first.decisionId).toBe('project-type');
    expect(first.originalProposal).toBe('Original proposal');
    expect(first.resolvedValue).toBe('Revised proposal');
    expect(first.userNote).toBe('too vague');
    expect(first.timestamp).toBeTypeOf('string');
  });
});
