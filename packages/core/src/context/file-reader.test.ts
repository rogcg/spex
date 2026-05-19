import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readProjectFiles } from './file-reader.js';

let projectDir: string;

async function w(rel: string, content: string): Promise<void> {
  const path = join(projectDir, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

describe('readProjectFiles', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-context-fr-'));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('returns allowed source files with content, bytes, and estimated tokens', async () => {
    await w('src/index.ts', 'export const x = 1;\n');
    await w('src/util.ts', 'export function f() { return 0; }\n');

    const { files } = await readProjectFiles({ projectDir });
    expect(files).toHaveLength(2);
    const index = files.find((f) => f.path === 'src/index.ts');
    expect(index).toBeDefined();
    expect(index?.content).toContain('export const x');
    expect(index?.bytes).toBeGreaterThan(0);
    expect(index?.estimatedTokens).toBeGreaterThan(0);
  });

  it('returns files sorted by path', async () => {
    await w('z/b.ts', 'x');
    await w('a/c.ts', 'y');
    await w('a/a.ts', 'z');

    const { files } = await readProjectFiles({ projectDir });
    expect(files.map((f) => f.path)).toEqual(['a/a.ts', 'a/c.ts', 'z/b.ts']);
  });

  it('honors .gitignore patterns', async () => {
    await w('.gitignore', 'secret.ts\nignored-dir/\n');
    await w('secret.ts', 'top secret');
    await w('ignored-dir/keep.ts', 'should be hidden');
    await w('keep.ts', 'public');

    const { files } = await readProjectFiles({ projectDir });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('keep.ts');
    expect(paths).not.toContain('secret.ts');
    expect(paths).not.toContain('ignored-dir/keep.ts');
  });

  it('hardcoded-ignores node_modules even without a .gitignore', async () => {
    await w('node_modules/foo/index.ts', 'no');
    await w('src/index.ts', 'yes');

    const { files } = await readProjectFiles({ projectDir });
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(['src/index.ts']);
  });

  it('hardcoded-ignores common build directories (.next, dist, build, .git)', async () => {
    await w('.next/static/x.js', 'x');
    await w('dist/index.js', 'x');
    await w('build/index.js', 'x');
    await w('.git/HEAD', 'ref:');
    await w('src/index.ts', 'keep');

    const { files } = await readProjectFiles({ projectDir });
    expect(files.map((f) => f.path)).toEqual(['src/index.ts']);
  });

  it('skips files with extensions outside the allowlist', async () => {
    await w('src/index.ts', 'x');
    await w('img.png', 'binary');
    await w('lockfile.lock', 'data');

    const { files } = await readProjectFiles({ projectDir });
    expect(files.map((f) => f.path)).toEqual(['src/index.ts']);
  });

  it('counts files skipped because they exceeded maxFileBytes', async () => {
    await w('huge.ts', 'x'.repeat(2000));
    await w('small.ts', 'export const a = 1;\n');

    const { files, skippedTooLarge } = await readProjectFiles({
      projectDir,
      maxFileBytes: 100,
    });
    expect(files.map((f) => f.path)).toEqual(['small.ts']);
    expect(skippedTooLarge).toBe(1);
  });

  it('supports a custom extensions allowlist', async () => {
    await w('src/index.ts', 'ts');
    await w('config.lock', 'lock');

    const { files } = await readProjectFiles({
      projectDir,
      allowedExtensions: new Set(['.lock']),
    });
    expect(files.map((f) => f.path)).toEqual(['config.lock']);
  });
});
