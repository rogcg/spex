import { resolve } from 'node:path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createStateStore } from '@spex/core';
import { z } from 'zod';
import { type ToolDefinition, errorResult, jsonTextResult } from './types.js';

export const SpexResumeInputSchema = z.object({
  project_dir: z.string().optional(),
  workflow_id: z.string().optional(),
  /** When true, only enumerate workflows — no state changes. */
  list: z.boolean().optional().default(false),
  /** When set, mark the workflow abandoned and remove its scratch dir. */
  abandon: z.string().optional(),
});
export type SpexResumeInput = z.infer<typeof SpexResumeInputSchema>;

const TOOL: Tool = {
  name: 'spex_resume',
  description:
    'Inspect and manage paused/incomplete SPEX workflows under `.ai/scratch/`. By default returns the list of resumable workflows + the one chosen for resume (or matched by `workflow_id`). Pass `list: true` to enumerate only. Pass `abandon: <id>` to delete a workflow.',
  inputSchema: {
    type: 'object',
    properties: {
      project_dir: {
        type: 'string',
        description: 'Project root directory. Defaults to the server cwd.',
      },
      workflow_id: {
        type: 'string',
        description: 'Resume this specific workflow id.',
      },
      list: {
        type: 'boolean',
        description: 'List workflows without changing state. Default: false.',
        default: false,
      },
      abandon: {
        type: 'string',
        description: 'Abandon (delete) the workflow with this id.',
      },
    },
  },
};

export const spexResumeToolDefinition: ToolDefinition = {
  tool: TOOL,
  handle: async (rawInput) => {
    const parsed = SpexResumeInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return errorResult('Invalid input for spex_resume', {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const input = parsed.data;
    const projectDir = input.project_dir ? resolve(input.project_dir) : resolve(process.cwd());
    const store = createStateStore({ projectDir });

    if (input.abandon) {
      const state = await store.load(input.abandon);
      if (!state) {
        return errorResult(`No workflow found with id "${input.abandon}".`);
      }
      await store.delete(input.abandon);
      return jsonTextResult({ status: 'success', abandoned: input.abandon });
    }

    const workflows = await store.list();
    const resumable = workflows.filter(
      (s) => s.status === 'paused' || s.status === 'running' || s.status === 'crashed',
    );

    if (input.list) {
      return jsonTextResult({ status: 'success', workflows });
    }

    if (input.workflow_id) {
      const match = workflows.find((s) => s.workflowId === input.workflow_id);
      if (!match) {
        return errorResult(`No workflow found with id "${input.workflow_id}".`);
      }
      return jsonTextResult({ status: 'success', resume: match });
    }

    if (resumable.length === 0) {
      return jsonTextResult({ status: 'success', message: 'No active workflows', workflows });
    }

    return jsonTextResult({ status: 'success', resumable, workflows });
  },
};
