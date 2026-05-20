import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type AuditEvent, AuditEventSchema } from '@spex/schemas';
import { DEFAULT_AUDIT_RELATIVE } from '../state/paths.js';
import { type RedactionOptions, redact } from './redact.js';

export interface AuditLogger {
  readonly auditDir: string;
  log(event: Omit<AuditEvent, 'timestamp'> & { timestamp?: string }): Promise<AuditEvent>;
  globalPath(): string;
  workflowPath(workflowId: string): string;
}

export interface CreateAuditLoggerOptions {
  projectDir: string;
  /** Override .ai/audit/. */
  auditDir?: string;
  redaction?: RedactionOptions;
  /** Override `new Date()`. Test-only. */
  now?: () => Date;
}

export const AUDIT_GLOBAL_FILE = 'global.jsonl';

export function workflowAuditFile(workflowId: string): string {
  return `workflow-${workflowId}.jsonl`;
}

export function createAuditLogger(opts: CreateAuditLoggerOptions): AuditLogger {
  const auditDir = opts.auditDir ?? join(opts.projectDir, DEFAULT_AUDIT_RELATIVE);
  const now = opts.now ?? (() => new Date());
  const redaction = opts.redaction;

  return {
    auditDir,
    globalPath: () => join(auditDir, AUDIT_GLOBAL_FILE),
    workflowPath: (workflowId) => join(auditDir, workflowAuditFile(workflowId)),
    async log(event) {
      const timestamp = event.timestamp ?? now().toISOString();
      const redactedPayload = redact(event.payload, redaction) as AuditEvent['payload'];
      const candidate = AuditEventSchema.parse({
        ...event,
        timestamp,
        payload: redactedPayload,
      });
      await mkdir(auditDir, { recursive: true });
      const line = `${JSON.stringify(candidate)}\n`;
      await appendFile(join(auditDir, AUDIT_GLOBAL_FILE), line, 'utf8');
      await appendFile(join(auditDir, workflowAuditFile(candidate.workflowId)), line, 'utf8');
      return candidate;
    },
  };
}
