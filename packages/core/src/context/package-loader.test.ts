import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PackageJsonInvalidError,
  PackageJsonMissingError,
  loadPackageInfo,
} from './package-loader.js';

let projectDir: string;

describe('loadPackageInfo', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-context-pkg-'));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('returns structured info from a typical Next.js package.json', async () => {
    await writeFile(
      join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'demo-app',
        version: '0.1.0',
        scripts: { dev: 'next dev', build: 'next build' },
        dependencies: { next: '^15.0.0', react: '^19.0.0' },
        devDependencies: { typescript: '^5.0.0' },
      }),
      'utf8',
    );
    const info = await loadPackageInfo(projectDir);
    expect(info.name).toBe('demo-app');
    expect(info.version).toBe('0.1.0');
    expect(info.scripts).toEqual({ dev: 'next dev', build: 'next build' });
    expect(info.dependencies).toEqual({ next: '^15.0.0', react: '^19.0.0' });
    expect(info.devDependencies).toEqual({ typescript: '^5.0.0' });
    expect(info.peerDependencies).toEqual({});
  });

  it('returns null name/version when those fields are missing', async () => {
    await writeFile(join(projectDir, 'package.json'), JSON.stringify({}), 'utf8');
    const info = await loadPackageInfo(projectDir);
    expect(info.name).toBeNull();
    expect(info.version).toBeNull();
  });

  it('throws PackageJsonMissingError when no package.json exists', async () => {
    await expect(loadPackageInfo(projectDir)).rejects.toThrow(PackageJsonMissingError);
  });

  it('throws PackageJsonInvalidError when JSON is malformed', async () => {
    await writeFile(join(projectDir, 'package.json'), '{not json', 'utf8');
    await expect(loadPackageInfo(projectDir)).rejects.toThrow(PackageJsonInvalidError);
  });

  it('throws PackageJsonInvalidError when JSON is an array', async () => {
    await writeFile(join(projectDir, 'package.json'), '[]', 'utf8');
    await expect(loadPackageInfo(projectDir)).rejects.toThrow(PackageJsonInvalidError);
  });

  it('drops non-string dependency values rather than throwing', async () => {
    await writeFile(
      join(projectDir, 'package.json'),
      JSON.stringify({
        dependencies: { next: '^15.0.0', bogus: 42 },
      }),
      'utf8',
    );
    const info = await loadPackageInfo(projectDir);
    expect(info.dependencies).toEqual({ next: '^15.0.0' });
  });
});
