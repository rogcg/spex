import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PathOutsideProjectError } from '../implementation/safety.js';
import { UnsupportedErrorSourceError, collectBugContext } from './collector.js';

let projectDir: string;

async function initRepo(): Promise<void> {
  await execa('git', ['init', '--initial-branch=main'], { cwd: projectDir });
  await execa('git', ['config', 'user.email', 'spex-test@example.com'], { cwd: projectDir });
  await execa('git', ['config', 'user.name', 'SPEX Test'], { cwd: projectDir });
  await execa('git', ['config', 'commit.gpgSign', 'false'], { cwd: projectDir });
}

async function writeIn(rel: string, content: string): Promise<void> {
  const path = join(projectDir, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

async function commit(message: string): Promise<void> {
  await execa('git', ['add', '.'], { cwd: projectDir });
  await execa('git', ['commit', '-m', message], { cwd: projectDir });
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'spex-bug-ctx-'));
});
afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('collectBugContext (manual mode)', () => {
  it('builds a context with recent commits filtered to the affected paths', async () => {
    await initRepo();
    await writeIn('src/users/page.tsx', 'v1');
    await commit('feat(users): initial');
    await writeIn('src/users/page.tsx', 'v2');
    await commit('feat(users): tweak');
    await writeIn('src/other/page.tsx', 'unrelated');
    await commit('chore: unrelated change');

    const context = await collectBugContext({
      projectDir,
      description: 'Users page renders empty on first visit',
      affectedFiles: ['src/users/page.tsx'],
    });

    expect(context.description).toBe('Users page renders empty on first visit');
    expect(context.affectedFiles).toEqual(['src/users/page.tsx']);
    // Recent commits only include those that touched the affected path.
    expect(context.recentCommits.map((c) => c.message)).toEqual([
      'feat(users): tweak',
      'feat(users): initial',
    ]);
    for (const c of context.recentCommits) {
      expect(c.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(c.date).toMatch(/^20\d\d-/);
    }
  });

  it('inlines file contents for affected files by default', async () => {
    await initRepo();
    await writeIn('src/a.ts', 'export const a = 1;\n');
    await writeIn('src/b.ts', 'export const b = 2;\n');
    await commit('feat: a and b');

    const context = await collectBugContext({
      projectDir,
      description: 'a leaks into b',
      affectedFiles: ['src/a.ts', 'src/b.ts'],
    });

    expect(context.affectedFileContents).toEqual({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
    });
  });

  it('omits affectedFileContents when readFileContents=false', async () => {
    await initRepo();
    await writeIn('src/a.ts', 'export const a = 1;\n');
    await commit('feat: a');

    const context = await collectBugContext({
      projectDir,
      description: 'a is wrong',
      affectedFiles: ['src/a.ts'],
      readFileContents: false,
    });

    expect(context.affectedFileContents).toBeUndefined();
  });

  it('returns commits across all paths when affectedFiles is empty', async () => {
    await initRepo();
    await writeIn('src/a.ts', 'x');
    await commit('feat: a');
    await writeIn('src/b.ts', 'x');
    await commit('feat: b');

    const context = await collectBugContext({
      projectDir,
      description: 'general regression',
      affectedFiles: [],
    });

    expect(context.recentCommits.map((c) => c.message)).toEqual(['feat: b', 'feat: a']);
    expect(context.affectedFileContents).toBeUndefined();
  });

  it('honours commitLimit', async () => {
    await initRepo();
    for (let i = 0; i < 5; i += 1) {
      await writeIn('src/x.ts', `v${i}`);
      await commit(`feat: x ${i}`);
    }

    const context = await collectBugContext({
      projectDir,
      description: 'thrash',
      affectedFiles: ['src/x.ts'],
      commitLimit: 2,
    });
    expect(context.recentCommits).toHaveLength(2);
    expect(context.recentCommits[0]?.message).toBe('feat: x 4');
    expect(context.recentCommits[1]?.message).toBe('feat: x 3');
  });

  it('passes through error info verbatim', async () => {
    await initRepo();
    await writeIn('src/a.ts', 'x');
    await commit('feat: a');

    const context = await collectBugContext({
      projectDir,
      description: 'Type error in pagination component',
      error: {
        message: 'TypeError: cannot read property length of undefined',
        stack: 'at Pagination (src/components/pagination.tsx:42:18)',
        firstOccurrence: '2026-05-17T10:00:00Z',
      },
      affectedFiles: ['src/a.ts'],
    });

    expect(context.error).toEqual({
      message: 'TypeError: cannot read property length of undefined',
      stack: 'at Pagination (src/components/pagination.tsx:42:18)',
      firstOccurrence: '2026-05-17T10:00:00Z',
    });
  });

  it('returns recentCommits=[] when the project is not a git repo', async () => {
    // No initRepo() — projectDir is just a plain mkdtemp dir.
    await writeIn('src/a.ts', 'x');

    const context = await collectBugContext({
      projectDir,
      description: 'no repo, just a description',
      affectedFiles: ['src/a.ts'],
    });

    expect(context.recentCommits).toEqual([]);
    expect(context.affectedFileContents).toEqual({ 'src/a.ts': 'x' });
  });

  it('skips files larger than maxFileBytes from affectedFileContents', async () => {
    await initRepo();
    await writeIn('src/big.ts', 'x'.repeat(2000));
    await writeIn('src/small.ts', 'y');
    await commit('feat: files');

    const context = await collectBugContext({
      projectDir,
      description: 'sizing',
      affectedFiles: ['src/big.ts', 'src/small.ts'],
      maxFileBytes: 100,
    });

    expect(context.affectedFileContents).toEqual({ 'src/small.ts': 'y' });
  });
});

describe('collectBugContext — error paths', () => {
  it('throws when description is blank', async () => {
    await initRepo();
    await expect(
      collectBugContext({ projectDir, description: '   ', affectedFiles: [] }),
    ).rejects.toThrow(/description is required/);
  });

  it('throws PathOutsideProjectError when an affectedFile escapes the project root', async () => {
    await initRepo();
    await expect(
      collectBugContext({
        projectDir,
        description: 'malicious path',
        affectedFiles: ['../outside.ts'],
      }),
    ).rejects.toBeInstanceOf(PathOutsideProjectError);
  });

  it('rejects non-manual error reference sources', async () => {
    await initRepo();
    await expect(
      collectBugContext({
        projectDir,
        description: 'from posthog',
        affectedFiles: [],
        errorReference: { source: 'posthog', id: 'evt-123' },
      }),
    ).rejects.toBeInstanceOf(UnsupportedErrorSourceError);
  });

  it('accepts manual error references and stores them on the context', async () => {
    await initRepo();
    const context = await collectBugContext({
      projectDir,
      description: 'manual report',
      affectedFiles: [],
      errorReference: { source: 'manual', id: 'team-chat-2026-05-17' },
    });
    expect(context.errorReference).toEqual({
      source: 'manual',
      id: 'team-chat-2026-05-17',
    });
  });
});
