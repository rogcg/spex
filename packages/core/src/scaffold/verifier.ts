import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScaffoldPlan } from '@spex/schemas';
import { execa } from 'execa';

export interface ScaffoldVerificationResult {
  ok: boolean;
  failedPostConditions: string[];
  notes: string;
}

export interface VerifyScaffoldOptions {
  plan: ScaffoldPlan;
  projectDir: string;
  /**
   * Override the runner used for shell-based smoke commands (typecheck/build).
   * Defaults to a real execa call. Tests pass a stub.
   */
  runShell?: (
    cmd: string,
    args: readonly string[],
    cwd: string,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export async function verifyScaffold(
  opts: VerifyScaffoldOptions,
): Promise<ScaffoldVerificationResult> {
  const failedPostConditions: string[] = [];
  const notes: string[] = [];

  const runShell = opts.runShell ?? defaultRunShell;

  for (const condition of opts.plan.postConditions) {
    const check = await checkPostCondition({
      condition,
      projectDir: opts.projectDir,
      runShell,
    });
    if (!check.ok) {
      failedPostConditions.push(condition);
      if (check.note) notes.push(`${condition}: ${check.note}`);
    }
  }

  return {
    ok: failedPostConditions.length === 0,
    failedPostConditions,
    notes: notes.join('\n'),
  };
}

interface PostConditionCheckArgs {
  condition: string;
  projectDir: string;
  runShell: NonNullable<VerifyScaffoldOptions['runShell']>;
}

async function checkPostCondition(
  args: PostConditionCheckArgs,
): Promise<{ ok: boolean; note?: string }> {
  const condition = args.condition;
  const lower = condition.toLowerCase();

  const filePath = extractFilePath(condition);
  if (filePath) {
    try {
      await access(join(args.projectDir, filePath));
      return { ok: true };
    } catch {
      return { ok: false, note: `file not found: ${filePath}` };
    }
  }

  if (lower.includes('package.json') && lower.includes('depend')) {
    const dep = extractDependencyName(condition);
    if (dep) {
      const pkgPath = join(args.projectDir, 'package.json');
      try {
        const raw = await readFile(pkgPath, 'utf8');
        const pkg = JSON.parse(raw) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        if (pkg.dependencies?.[dep] || pkg.devDependencies?.[dep]) {
          return { ok: true };
        }
        return { ok: false, note: `dependency "${dep}" not declared in package.json` };
      } catch (err) {
        return {
          ok: false,
          note: `failed to read package.json: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }

  if (lower.includes('typecheck') || lower.includes('type check') || lower.includes('tsc passes')) {
    return runVerifyCommand(args, 'pnpm', ['exec', 'tsc', '--noEmit']);
  }

  if (lower.includes('build') && !lower.includes('does not build')) {
    return runVerifyCommand(args, 'pnpm', ['run', 'build']);
  }

  if (lower.includes('install succeeds') || lower.includes('pnpm install')) {
    return runVerifyCommand(args, 'pnpm', ['install', '--frozen-lockfile=false']);
  }

  // Default: condition is informational — treat as satisfied.
  return { ok: true };
}

async function runVerifyCommand(
  args: PostConditionCheckArgs,
  cmd: string,
  cmdArgs: readonly string[],
): Promise<{ ok: boolean; note?: string }> {
  const result = await args.runShell(cmd, cmdArgs, args.projectDir);
  if (result.exitCode === 0) return { ok: true };
  return {
    ok: false,
    note: `${cmd} ${cmdArgs.join(' ')} exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`,
  };
}

function extractFilePath(condition: string): string | null {
  // Look for things like "drizzle.config.ts exists" or "src/main.ts exists".
  const match = condition.match(/([\w./-]+\.[a-zA-Z]+)\s+(?:exists|is present|is created)/);
  if (match?.[1]) return match[1];
  return null;
}

function extractDependencyName(condition: string): string | null {
  const m = condition.match(/['"]([@\w./-]+)['"]/);
  if (m?.[1]) return m[1];
  return null;
}

async function defaultRunShell(
  cmd: string,
  args: readonly string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const result = await execa(cmd, args, { cwd, stdio: 'pipe', timeout: DEFAULT_TIMEOUT_MS });
    return { exitCode: result.exitCode ?? 0, stdout: result.stdout, stderr: result.stderr };
  } catch (err) {
    const exitCode =
      err !== null &&
      typeof err === 'object' &&
      typeof (err as { exitCode?: unknown }).exitCode === 'number'
        ? (err as { exitCode: number }).exitCode
        : 1;
    const stderr =
      err !== null &&
      typeof err === 'object' &&
      typeof (err as { stderr?: unknown }).stderr === 'string'
        ? (err as { stderr: string }).stderr
        : err instanceof Error
          ? err.message
          : String(err);
    const stdout =
      err !== null &&
      typeof err === 'object' &&
      typeof (err as { stdout?: unknown }).stdout === 'string'
        ? (err as { stdout: string }).stdout
        : '';
    return { exitCode, stdout, stderr };
  }
}
