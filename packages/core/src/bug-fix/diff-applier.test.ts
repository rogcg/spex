import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PathOutsideProjectError } from '../implementation/safety.js';
import { FixDiffApplyError, applyFixDiff, revertFixDiff } from './diff-applier.js';

let projectDir: string;

async function writeIn(rel: string, content: string): Promise<void> {
  const path = join(projectDir, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'spex-diff-app-'));
});
afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('applyFixDiff', () => {
  it('applies a unified diff to an existing file and snapshots the prior content', async () => {
    await writeIn('src/users/page.tsx', 'export const x = 1;\n');

    const diff = `--- a/src/users/page.tsx
+++ b/src/users/page.tsx
@@ -1 +1 @@
-export const x = 1;
+export const x = 2;
`;

    const result = await applyFixDiff(projectDir, diff);

    expect(result.affectedPaths).toEqual(['src/users/page.tsx']);
    expect(await readFile(join(projectDir, 'src/users/page.tsx'), 'utf8')).toBe(
      'export const x = 2;\n',
    );
    expect(result.snapshots[0]).toMatchObject({
      path: 'src/users/page.tsx',
      existedBefore: true,
      contentBefore: 'export const x = 1;\n',
      contentAfter: 'export const x = 2;\n',
    });
  });

  it('handles a multi-file diff', async () => {
    await writeIn('src/a.ts', 'old a\n');
    await writeIn('src/b.ts', 'old b\n');

    const diff = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old a
+new a
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-old b
+new b
`;
    const result = await applyFixDiff(projectDir, diff);
    expect(result.affectedPaths.sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(await readFile(join(projectDir, 'src/a.ts'), 'utf8')).toBe('new a\n');
    expect(await readFile(join(projectDir, 'src/b.ts'), 'utf8')).toBe('new b\n');
  });

  it('atomically rolls back when one of several files fails to apply', async () => {
    await writeIn('src/a.ts', 'old a\n');
    // src/b.ts does NOT exist with the expected baseline → patch should fail
    const diff = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old a
+new a
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-totally different baseline
+new b
`;
    await expect(applyFixDiff(projectDir, diff)).rejects.toBeInstanceOf(FixDiffApplyError);
    // src/a.ts must be restored to its original content
    expect(await readFile(join(projectDir, 'src/a.ts'), 'utf8')).toBe('old a\n');
    // src/b.ts must not exist (it was never created since the patch failed before write)
    let exists = true;
    try {
      await readFile(join(projectDir, 'src/b.ts'), 'utf8');
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  it('throws PathOutsideProjectError on a traversal path', async () => {
    const diff = `--- a/../escape.ts
+++ b/../escape.ts
@@ -1 +1 @@
-x
+y
`;
    await expect(applyFixDiff(projectDir, diff)).rejects.toBeInstanceOf(PathOutsideProjectError);
  });

  it('rejects an empty diff', async () => {
    await expect(applyFixDiff(projectDir, '')).rejects.toBeInstanceOf(FixDiffApplyError);
  });
});

describe('revertFixDiff', () => {
  it('restores files to their original content', async () => {
    await writeIn('src/a.ts', 'old\n');
    const diff = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
`;
    const result = await applyFixDiff(projectDir, diff);
    expect(await readFile(join(projectDir, 'src/a.ts'), 'utf8')).toBe('new\n');
    await revertFixDiff(result.snapshots);
    expect(await readFile(join(projectDir, 'src/a.ts'), 'utf8')).toBe('old\n');
  });
});
