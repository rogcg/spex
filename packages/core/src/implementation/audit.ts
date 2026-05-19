import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export type AuditRecord =
  | {
      type: 'run-start';
      timestamp: string;
      feature_slug: string;
      mode: 'auto' | 'step-by-step';
      operation_count: number;
    }
  | {
      type: 'op';
      timestamp: string;
      order: number;
      path: string;
      operation: 'create' | 'modify' | 'delete' | 'test-create';
      outcome: 'applied' | 'skipped' | 'failed';
      error?: string;
    }
  | {
      type: 'rollback';
      timestamp: string;
      order: number;
      path: string;
      action: 'restore' | 'delete';
    }
  | {
      type: 'run-end';
      timestamp: string;
      outcome: 'success' | 'failure';
      applied_count: number;
      skipped_count: number;
      rolled_back_count: number;
      error?: string;
    };

export interface AuditLog {
  path: string;
  append(record: AuditRecord): Promise<void>;
}

export interface OpenAuditLogOptions {
  projectDir: string;
  featureSlug: string;
  now?: () => Date;
  auditDir?: string;
}

export async function openAuditLog(options: OpenAuditLogOptions): Promise<AuditLog> {
  const now = options.now ?? (() => new Date());
  const dir = options.auditDir ?? join(options.projectDir, '.ai', 'audit');
  await mkdir(dir, { recursive: true });
  const stamp = formatStamp(now());
  const path = join(dir, `${stamp}-${options.featureSlug}.jsonl`);
  // Touch the file so that the audit log exists as soon as it's "opened",
  // even before the first record is appended.
  await appendFile(path, '', 'utf8');
  return {
    path,
    async append(record) {
      await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
    },
  };
}

function formatStamp(d: Date): string {
  // Filesystem-safe ISO timestamp (no colons): 2026-05-17T18-22-09-123Z
  return d.toISOString().replace(/[:.]/g, '-');
}
