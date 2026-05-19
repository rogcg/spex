import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiFolderExistsError, assertAiFolderAbsent } from './precheck.js';

let projectDir: string;

describe('assertAiFolderAbsent', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-init-precheck-'));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('resolves when .ai/ does not exist', async () => {
    await expect(assertAiFolderAbsent({ projectDir })).resolves.toBeUndefined();
  });

  it('throws AiFolderExistsError when .ai/ directory exists', async () => {
    await mkdir(join(projectDir, '.ai'), { recursive: true });
    await expect(assertAiFolderAbsent({ projectDir })).rejects.toThrow(AiFolderExistsError);
  });

  it('resolves even when .ai/ exists if force is true', async () => {
    await mkdir(join(projectDir, '.ai'), { recursive: true });
    await expect(assertAiFolderAbsent({ projectDir, force: true })).resolves.toBeUndefined();
  });

  it('does not throw when .ai is a regular file (not a directory)', async () => {
    await writeFile(join(projectDir, '.ai'), 'not a folder', 'utf8');
    await expect(assertAiFolderAbsent({ projectDir })).resolves.toBeUndefined();
  });
});
