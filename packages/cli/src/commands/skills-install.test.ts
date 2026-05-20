import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSkillsInstallScope, runSkillsInstallCommand } from './skills-install.js';

describe('runSkillsInstallCommand', () => {
  let srcDir: string;
  let destDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    srcDir = await mkdtemp(join(tmpdir(), 'spex-skills-install-src-'));
    destDir = await mkdtemp(join(tmpdir(), 'spex-skills-install-dest-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(srcDir, { recursive: true, force: true });
    await rm(destDir, { recursive: true, force: true });
  });

  async function seedSkill(name: string, frontmatter: string, body: string): Promise<void> {
    const dir = join(srcDir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`, 'utf8');
  }

  it('copies all loaded skills to the destination preserving SKILL.md content', async () => {
    await seedSkill('alpha', 'name: alpha\ndescription: A.', 'Alpha body.');
    await seedSkill('beta', 'name: beta\ndescription: B.', 'Beta body.');

    await runSkillsInstallCommand({
      destOverride: destDir,
      sourceRootOverride: srcDir,
    });

    const alpha = await readFile(join(destDir, 'alpha', 'SKILL.md'), 'utf8');
    const beta = await readFile(join(destDir, 'beta', 'SKILL.md'), 'utf8');
    expect(alpha).toContain('name: alpha');
    expect(alpha).toContain('Alpha body.');
    expect(beta).toContain('name: beta');
    expect(beta).toContain('Beta body.');
  });

  it('is idempotent — re-running overwrites existing files without error', async () => {
    await seedSkill('alpha', 'name: alpha\ndescription: A.', 'First.');
    await runSkillsInstallCommand({ destOverride: destDir, sourceRootOverride: srcDir });

    // Update the source and re-install
    await writeFile(
      join(srcDir, 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: A.\n---\nSecond.',
      'utf8',
    );
    await runSkillsInstallCommand({ destOverride: destDir, sourceRootOverride: srcDir });

    const content = await readFile(join(destDir, 'alpha', 'SKILL.md'), 'utf8');
    expect(content).toContain('Second.');
    expect(content).not.toContain('First.');
  });

  it('creates the destination directory tree if it does not exist', async () => {
    await seedSkill('alpha', 'name: alpha\ndescription: A.', 'Body');
    const deepDest = join(destDir, 'deep', 'nested', 'path');

    await runSkillsInstallCommand({
      destOverride: deepDest,
      sourceRootOverride: srcDir,
    });

    const content = await readFile(join(deepDest, 'alpha', 'SKILL.md'), 'utf8');
    expect(content).toContain('Body');
  });

  it('logs a no-skills message when the source directory is empty', async () => {
    await runSkillsInstallCommand({
      destOverride: destDir,
      sourceRootOverride: srcDir,
    });

    const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/no skills/i);
  });
});

describe('parseSkillsInstallScope', () => {
  it('accepts "user"', () => {
    expect(parseSkillsInstallScope('user')).toBe('user');
  });

  it('accepts "project"', () => {
    expect(parseSkillsInstallScope('project')).toBe('project');
  });

  it('throws on invalid values', () => {
    expect(() => parseSkillsInstallScope('global')).toThrow(/invalid scope/);
  });
});
