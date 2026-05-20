import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type AuditEvent, AuditEventSchema } from '@spex/schemas';
import { DEFAULT_AUDIT_RELATIVE } from '../state/paths.js';
import { AUDIT_GLOBAL_FILE } from './logger.js';

export interface AuditReader {
  readonly auditDir: string;
  read(opts?: { workflowId?: string }): Promise<AuditEvent[]>;
  listWorkflowFiles(): Promise<string[]>;
}

export interface CreateAuditReaderOptions {
  projectDir: string;
  auditDir?: string;
}

export function createAuditReader(opts: CreateAuditReaderOptions): AuditReader {
  const auditDir = opts.auditDir ?? join(opts.projectDir, DEFAULT_AUDIT_RELATIVE);

  return {
    auditDir,
    async read({ workflowId } = {}) {
      const path = workflowId
        ? join(auditDir, `workflow-${workflowId}.jsonl`)
        : join(auditDir, AUDIT_GLOBAL_FILE);
      return readEvents(path);
    },
    async listWorkflowFiles() {
      let entries: string[];
      try {
        entries = await readdir(auditDir);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'ENOENT') return [];
        throw error;
      }
      return entries.filter((f) => f.startsWith('workflow-') && f.endsWith('.jsonl')).sort();
    },
  };
}

async function readEvents(path: string): Promise<AuditEvent[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') return [];
    throw error;
  }
  const events: AuditEvent[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Skip corrupt lines (a partial write at the tail, for example).
      continue;
    }
    const result = AuditEventSchema.safeParse(parsed);
    if (result.success) {
      events.push(result.data);
    }
  }
  return events;
}
