import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Decision } from '@spex/schemas';

export interface DecisionAuditEntry {
  decisionId: string;
  order: number;
  category: string;
  techSpecPath: string;
  status: Decision['status'];
  confidence: Decision['confidence'];
  proposal: string;
  resolvedValue?: string;
  rationale: string;
  userNote?: string;
  timestamp: string;
  /** Mirrors the original AI proposal even when the user overrode it. */
  originalProposal: string;
  /** Captures the original rationale before any revision. */
  originalRationale: string;
}

/**
 * Resolve the absolute path of a fresh decisions audit log file.
 *
 * The file is suffixed with an ISO-like timestamp (colons removed for FS safety)
 * to make every `spex new` / `spex spec evolve` produce a distinct, append-only log.
 */
export function auditLogPath(opts: { projectDir: string; now?: Date }): string {
  const now = opts.now ?? new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return join(opts.projectDir, '.ai', 'audit', `decisions-${stamp}.jsonl`);
}

export async function appendDecisionAuditEntry(
  path: string,
  entry: DecisionAuditEntry,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
}

export function buildAuditEntry(opts: {
  decision: Decision;
  original: Decision;
  now?: Date;
}): DecisionAuditEntry {
  const now = opts.now ?? new Date();
  const entry: DecisionAuditEntry = {
    decisionId: opts.decision.id,
    order: opts.decision.order,
    category: opts.decision.category,
    techSpecPath: opts.decision.techSpecPath,
    status: opts.decision.status,
    confidence: opts.decision.confidence,
    proposal: opts.decision.proposal,
    rationale: opts.decision.rationale,
    timestamp: now.toISOString(),
    originalProposal: opts.original.proposal,
    originalRationale: opts.original.rationale,
  };
  if (opts.decision.resolvedValue !== undefined) {
    entry.resolvedValue = opts.decision.resolvedValue;
  }
  if (opts.decision.userNote !== undefined) {
    entry.userNote = opts.decision.userNote;
  }
  return entry;
}
