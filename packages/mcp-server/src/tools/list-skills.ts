import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { loadSkills } from '@spex/skills';
import { z } from 'zod';
import { type ToolDefinition, errorResult, jsonTextResult } from './types.js';

export const ListSkillsInputSchema = z.object({}).strict();
export type ListSkillsInput = z.infer<typeof ListSkillsInputSchema>;

const TOOL: Tool = {
  name: 'list_skills',
  description:
    "List the SPEX skill bundles available on this server. Returns each skill's manifest (name, description, optional allowed-tools). Use `get_skill` to fetch the full SKILL.md markdown body for a specific skill.",
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

export const listSkillsToolDefinition: ToolDefinition = {
  tool: TOOL,
  handle: async (rawInput, deps) => {
    const parsed = ListSkillsInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return errorResult('Invalid input for list_skills', {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    try {
      const skills = await loadSkills(deps.skillsRoot ? { rootDir: deps.skillsRoot } : {});
      return jsonTextResult({
        skills: skills.map((s) => ({
          name: s.manifest.name,
          description: s.manifest.description,
          'allowed-tools': s.manifest['allowed-tools'] ?? null,
        })),
      });
    } catch (cause) {
      return errorResult(cause instanceof Error ? cause.message : String(cause), {
        phase: 'load-skills',
      });
    }
  },
};
