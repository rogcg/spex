import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listSkillsToolDefinition } from './list-skills.js';

describe('list_skills MCP tool', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spex-mcp-list-skills-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(name: string, fm: string, body = 'body'): Promise<void> {
    const skillDir = join(dir, name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---\n${fm}\n---\n${body}`, 'utf8');
  }

  it('returns the manifest list with allowed-tools as null when absent', async () => {
    await seed('alpha', 'name: alpha\ndescription: A.');
    await seed('beta', 'name: beta\ndescription: B.\nallowed-tools:\n  - Read');

    const result = await listSkillsToolDefinition.handle({}, { skillsRoot: dir });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    const payload = JSON.parse(text);
    expect(payload).toEqual({
      skills: [
        { name: 'alpha', description: 'A.', 'allowed-tools': null },
        { name: 'beta', description: 'B.', 'allowed-tools': ['Read'] },
      ],
    });
  });

  it('returns an empty list when the source root has no skills', async () => {
    const result = await listSkillsToolDefinition.handle({}, { skillsRoot: dir });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({ skills: [] });
  });

  it('returns an error result for invalid (non-object) input', async () => {
    const result = await listSkillsToolDefinition.handle({ name: 'extra' } as unknown, {
      skillsRoot: dir,
    });
    expect(result.isError).toBe(true);
  });
});
