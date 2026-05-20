import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkillsError, getSkill, loadSkills } from './loader.js';

describe('loadSkills', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spex-skills-loader-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeSkill(name: string, frontmatter: string, body = 'body'): Promise<void> {
    const skillDir = join(dir, name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`, 'utf8');
  }

  it('loads a single skill with valid frontmatter', async () => {
    await writeSkill('my-skill', 'name: my-skill\ndescription: A test skill.', 'Hello world');
    const skills = await loadSkills({ rootDir: dir });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.manifest).toEqual({
      name: 'my-skill',
      description: 'A test skill.',
    });
    expect(skills[0]?.body).toBe('Hello world');
  });

  it('parses optional allowed-tools', async () => {
    await writeSkill(
      'with-tools',
      'name: with-tools\ndescription: Has tools.\nallowed-tools:\n  - Bash\n  - Read',
    );
    const skills = await loadSkills({ rootDir: dir });
    expect(skills[0]?.manifest['allowed-tools']).toEqual(['Bash', 'Read']);
  });

  it('loads multiple skills sorted by name', async () => {
    await writeSkill('zebra', 'name: zebra\ndescription: Z.');
    await writeSkill('apple', 'name: apple\ndescription: A.');
    const skills = await loadSkills({ rootDir: dir });
    expect(skills.map((s) => s.manifest.name)).toEqual(['apple', 'zebra']);
  });

  it('skips directories without SKILL.md', async () => {
    await writeSkill('real', 'name: real\ndescription: Real.');
    await mkdir(join(dir, 'not-a-skill'), { recursive: true });
    await writeFile(join(dir, 'not-a-skill', 'README.md'), 'not a skill', 'utf8');
    const skills = await loadSkills({ rootDir: dir });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.manifest.name).toBe('real');
  });

  it('throws SkillsError when frontmatter is missing', async () => {
    const skillDir = join(dir, 'bad');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# no frontmatter', 'utf8');
    await expect(loadSkills({ rootDir: dir })).rejects.toThrow(SkillsError);
  });

  it('throws SkillsError when name is not kebab-case', async () => {
    await writeSkill('bad', 'name: BadName\ndescription: B.');
    await expect(loadSkills({ rootDir: dir })).rejects.toThrow(SkillsError);
  });

  it('throws SkillsError when description is missing', async () => {
    await writeSkill('bad', 'name: bad');
    await expect(loadSkills({ rootDir: dir })).rejects.toThrow(SkillsError);
  });

  it('throws SkillsError when the root directory does not exist', async () => {
    await expect(loadSkills({ rootDir: join(dir, 'nonexistent') })).rejects.toThrow(SkillsError);
  });

  it('preserves multi-line body content verbatim', async () => {
    await writeSkill('multi', 'name: multi\ndescription: M.', '# Heading\n\nLine 1\nLine 2\n');
    const skills = await loadSkills({ rootDir: dir });
    expect(skills[0]?.body).toBe('# Heading\n\nLine 1\nLine 2\n');
  });
});

describe('getSkill', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spex-skills-getskill-'));
    const skillDir = join(dir, 'spex-discovery');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: spex-discovery\ndescription: Discovery.\n---\nBody',
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the matching skill', async () => {
    const skill = await getSkill('spex-discovery', { rootDir: dir });
    expect(skill?.manifest.name).toBe('spex-discovery');
    expect(skill?.body).toBe('Body');
  });

  it('returns null when no skill matches', async () => {
    const skill = await getSkill('nope', { rootDir: dir });
    expect(skill).toBeNull();
  });
});
