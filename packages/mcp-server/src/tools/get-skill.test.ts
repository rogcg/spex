import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSkillToolDefinition } from './get-skill.js';

describe('get_skill MCP tool', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spex-mcp-get-skill-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(name: string, body: string): Promise<void> {
    const skillDir = join(dir, name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} skill.\n---\n${body}`,
      'utf8',
    );
  }

  it('returns the manifest and the markdown body for a known skill', async () => {
    await seed('alpha', '# Alpha\n\nBody content.');
    const result = await getSkillToolDefinition.handle({ name: 'alpha' }, { skillsRoot: dir });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    const payload = JSON.parse(text);
    expect(payload.manifest).toEqual({
      name: 'alpha',
      description: 'alpha skill.',
    });
    expect(payload.body).toBe('# Alpha\n\nBody content.');
  });

  it('returns an error when the skill name is not found', async () => {
    await seed('alpha', 'body');
    const result = await getSkillToolDefinition.handle({ name: 'nope' }, { skillsRoot: dir });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text).message).toMatch(/not found/i);
  });

  it('returns an error for missing name input', async () => {
    const result = await getSkillToolDefinition.handle({}, { skillsRoot: dir });
    expect(result.isError).toBe(true);
  });

  it('returns an error for empty name string', async () => {
    const result = await getSkillToolDefinition.handle({ name: '' }, { skillsRoot: dir });
    expect(result.isError).toBe(true);
  });
});
