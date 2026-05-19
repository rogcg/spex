import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type BugContext,
  BugContextSchema,
  type BugErrorInfo,
  type ErrorReference,
  type RecentCommit,
} from '@spex/schemas';
import { SpexError } from '../errors.js';
import { GitCommandError, runGit } from '../git/run-git.js';
import { resolveInsideProject } from '../implementation/safety.js';

const DEFAULT_COMMIT_LIMIT = 20;
const DEFAULT_MAX_FILE_BYTES = 256_000;

// Use ASCII unit-separator (\x1f) between fields and ASCII record-separator
// (\x1e) between records so we can parse robustly even when commit messages
// contain newlines, tabs, pipes, or any other printable character.
const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';

export class UnsupportedErrorSourceError extends SpexError {
  readonly source: string;

  constructor(source: string) {
    super(`Bug context source "${source}" is not yet supported. Only "manual" is available.`);
    this.source = source;
  }
}

export interface CollectBugContextOptions {
  projectDir: string;
  description: string;
  error?: BugErrorInfo;
  /**
   * Project-relative paths the bug appears to involve. Used to filter recent
   * commits and (optionally) to inline file contents in the returned context.
   */
  affectedFiles?: readonly string[];
  /**
   * Provenance of the bug report. If supplied with a source other than
   * `manual`, throws `UnsupportedErrorSourceError` — non-manual sources are
   * placeholders for later sprints.
   */
  errorReference?: ErrorReference;
  /** Maximum number of recent commits to include. Defaults to 20. */
  commitLimit?: number;
  /** Read content of affected files into `affectedFileContents`. Defaults to true. */
  readFileContents?: boolean;
  /** Per-file size cap in bytes. Defaults to 256 KB. */
  maxFileBytes?: number;
}

export async function collectBugContext(options: CollectBugContextOptions): Promise<BugContext> {
  if (options.description.trim().length === 0) {
    throw new SpexError('collectBugContext: description is required');
  }
  if (options.errorReference && options.errorReference.source !== 'manual') {
    throw new UnsupportedErrorSourceError(options.errorReference.source);
  }

  const projectDir = resolve(options.projectDir);
  const affectedFiles = (options.affectedFiles ?? []).map((p) => {
    // Resolve to validate path is inside project, then convert back to a
    // project-relative POSIX path for storage in the schema.
    resolveInsideProject(projectDir, p);
    return p.replace(/\\/g, '/');
  });

  const commitLimit = options.commitLimit ?? DEFAULT_COMMIT_LIMIT;
  const recentCommits = await collectRecentCommits(projectDir, affectedFiles, commitLimit);

  let affectedFileContents: Record<string, string> | undefined;
  if ((options.readFileContents ?? true) && affectedFiles.length > 0) {
    affectedFileContents = await readAffectedFiles(
      projectDir,
      affectedFiles,
      options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    );
  }

  const context: BugContext = {
    description: options.description,
    affectedFiles,
    recentCommits,
    ...(options.error ? { error: options.error } : {}),
    ...(affectedFileContents ? { affectedFileContents } : {}),
    ...(options.errorReference ? { errorReference: options.errorReference } : {}),
  };

  // Defensive: validate the built object against the schema so any change to
  // the schema is caught here rather than at the LLM boundary downstream.
  const parsed = BugContextSchema.safeParse(context);
  if (!parsed.success) {
    throw new SpexError(
      `collectBugContext: built context failed schema validation: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

async function collectRecentCommits(
  projectDir: string,
  affectedFiles: readonly string[],
  limit: number,
): Promise<RecentCommit[]> {
  const format = `%H${FIELD_SEP}%s${FIELD_SEP}%cI`;
  const args = ['log', `--max-count=${limit}`, `--pretty=format:${format}${RECORD_SEP}`];
  if (affectedFiles.length > 0) {
    args.push('--', ...affectedFiles);
  }

  let stdout: string;
  try {
    const result = await runGit({ cwd: projectDir, args });
    stdout = result.stdout;
  } catch (cause) {
    // If git isn't initialised or there are no commits at all, treat the
    // recent-commit list as empty rather than failing the whole collection.
    if (cause instanceof GitCommandError) {
      return [];
    }
    throw cause;
  }

  const records = stdout
    .split(RECORD_SEP)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  const commits: RecentCommit[] = [];
  for (const record of records) {
    const parts = record.split(FIELD_SEP);
    if (parts.length < 3) continue;
    const [sha, message, date] = parts;
    if (!sha || !date) continue;
    commits.push({ sha, message: message ?? '', date });
  }
  return commits;
}

async function readAffectedFiles(
  projectDir: string,
  affectedFiles: readonly string[],
  maxBytes: number,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const relPath of affectedFiles) {
    const absolute = resolveInsideProject(projectDir, relPath);
    try {
      const stats = await stat(absolute);
      if (!stats.isFile()) continue;
      if (stats.size > maxBytes) continue;
      out[relPath] = await readFile(absolute, 'utf8');
    } catch {
      // Missing file: skip. This is a documented bug context — file may have
      // been moved or renamed since the bug was filed. Recent commits still
      // help orient the hypothesis generator.
    }
  }
  return out;
}
