import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type AuditReader, createAuditReader } from '@spex/core';
import type { AuditActor, AuditEvent, AuditEventType } from '@spex/schemas';
import { STRINGS } from '../strings.js';

export type LogsFormat = 'json' | 'table' | 'summary';

export interface LogsCommandOptions {
  workflowId?: string;
  since?: string;
  type?: string;
  actor?: string;
  format?: string;
  export?: string;
  tail?: boolean;
  limit?: number;
  projectDir?: string;
  /**
   * Test hook — override the underlying reader (e.g., to feed deterministic events).
   */
  readerOverride?: AuditReader;
  /** Test hook — override the clock for --since calculations. */
  nowOverride?: () => Date;
}

const AUDIT_EVENT_TYPES: readonly AuditEventType[] = [
  'llm_call',
  'decision',
  'file_write',
  'file_read',
  'git_operation',
  'tool_invocation',
  'approval',
  'error',
  'state_transition',
];

const AUDIT_ACTORS: readonly AuditActor[] = ['user', 'agent', 'system'];

export async function runLogsCommand(options: LogsCommandOptions = {}): Promise<void> {
  const projectDir = options.projectDir ?? resolve(process.cwd());
  const reader = options.readerOverride ?? createAuditReader({ projectDir });

  const eventType = parseEventType(options.type);
  const actor = parseActor(options.actor);
  const format = parseFormat(options.format);
  const sinceMs = options.since ? parseDuration(options.since) : null;
  const now = options.nowOverride ?? (() => new Date());
  const cutoff = sinceMs !== null ? now().getTime() - sinceMs : null;

  const filter = (event: AuditEvent): boolean => {
    if (eventType && event.type !== eventType) return false;
    if (actor && event.actor !== actor) return false;
    if (cutoff !== null) {
      const ts = Date.parse(event.timestamp);
      if (!Number.isFinite(ts) || ts < cutoff) return false;
    }
    return true;
  };

  const opts: { workflowId?: string } = {};
  if (options.workflowId !== undefined) opts.workflowId = options.workflowId;
  const all = await reader.read(opts);
  const filtered = all.filter(filter);
  const limited = options.limit && options.limit > 0 ? filtered.slice(-options.limit) : filtered;

  if (options.export) {
    await writeFile(options.export, JSON.stringify(limited, null, 2), 'utf8');
    console.log(STRINGS.logsCommand.exported(options.export, limited.length));
    return;
  }

  if (options.tail) {
    // The first implementation prints what we have. A streaming tail can be
    // layered on later via a watch on the JSONL file.
    renderEvents(limited, format);
    console.log(STRINGS.logsCommand.tailNoticeNotImplemented);
    return;
  }

  renderEvents(limited, format);
}

function renderEvents(events: readonly AuditEvent[], format: LogsFormat): void {
  if (events.length === 0) {
    console.log(STRINGS.logsCommand.noEvents);
    return;
  }
  switch (format) {
    case 'json':
      console.log(JSON.stringify(events, null, 2));
      return;
    case 'summary':
      renderSummary(events);
      return;
    case 'table':
      renderTable(events);
      return;
  }
}

function renderSummary(events: readonly AuditEvent[]): void {
  const byType = new Map<AuditEventType, number>();
  const byActor = new Map<AuditActor, number>();
  for (const e of events) {
    byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    byActor.set(e.actor, (byActor.get(e.actor) ?? 0) + 1);
  }
  console.log(STRINGS.logsCommand.summaryHeader(events.length));
  for (const [type, count] of [...byType.entries()].sort()) {
    console.log(`  ${type}: ${count}`);
  }
  console.log(STRINGS.logsCommand.summaryActorsHeader);
  for (const [actor, count] of [...byActor.entries()].sort()) {
    console.log(`  ${actor}: ${count}`);
  }
}

function renderTable(events: readonly AuditEvent[]): void {
  console.log(STRINGS.logsCommand.tableHeader);
  for (const e of events) {
    const ts = e.timestamp;
    console.log(`${ts}  ${e.actor.padEnd(7)}  ${e.type.padEnd(18)}  ${e.workflowId}`);
  }
}

function parseEventType(raw: string | undefined): AuditEventType | null {
  if (!raw) return null;
  if ((AUDIT_EVENT_TYPES as readonly string[]).includes(raw)) {
    return raw as AuditEventType;
  }
  throw new Error(STRINGS.logsCommand.invalidType(raw, [...AUDIT_EVENT_TYPES]));
}

function parseActor(raw: string | undefined): AuditActor | null {
  if (!raw) return null;
  if ((AUDIT_ACTORS as readonly string[]).includes(raw)) {
    return raw as AuditActor;
  }
  throw new Error(STRINGS.logsCommand.invalidActor(raw, [...AUDIT_ACTORS]));
}

function parseFormat(raw: string | undefined): LogsFormat {
  if (!raw) return 'table';
  if (raw === 'json' || raw === 'table' || raw === 'summary') return raw;
  throw new Error(STRINGS.logsCommand.invalidFormat(raw));
}

const DURATION_RE = /^(\d+)([smhdw])$/;
const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

export function parseDuration(raw: string): number {
  const match = raw.trim().toLowerCase().match(DURATION_RE);
  if (!match) {
    throw new Error(STRINGS.logsCommand.invalidSince(raw));
  }
  const [, n, unit] = match;
  const mult = DURATION_UNITS[unit ?? ''];
  if (!mult) {
    throw new Error(STRINGS.logsCommand.invalidSince(raw));
  }
  return Number.parseInt(n ?? '0', 10) * mult;
}
