import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getSkill } from '@spex/skills';
import { z } from 'zod';
import { type ToolDefinition, errorResult, jsonTextResult } from './types.js';

export const GetSkillInputSchema = z.object({
  name: z.string().min(1, 'name is required'),
});
export type GetSkillInput = z.infer<typeof GetSkillInputSchema>;

const TOOL: Tool = {
  name: 'get_skill',
  description:
    'Fetch a single SPEX skill by name. Returns the manifest plus the full SKILL.md markdown body. Use `list_skills` to discover available names.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Skill name (kebab-case, matches the manifest `name` field).',
      },
    },
    required: ['name'],
  },
};

export const getSkillToolDefinition: ToolDefinition = {
  tool: TOOL,
  handle: async (rawInput, deps) => {
    const parsed = GetSkillInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return errorResult('Invalid input for get_skill', {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    try {
      const skill = await getSkill(
        parsed.data.name,
        deps.skillsRoot ? { rootDir: deps.skillsRoot } : {},
      );
      if (!skill) {
        return errorResult(`Skill not found: ${parsed.data.name}`, {
          name: parsed.data.name,
        });
      }
      return jsonTextResult({
        manifest: skill.manifest,
        body: skill.body,
      });
    } catch (cause) {
      return errorResult(cause instanceof Error ? cause.message : String(cause), {
        phase: 'load-skill',
      });
    }
  },
};
