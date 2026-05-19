import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpexError } from '@spex/core';

export const WORKFLOW_TEMPLATES = [
  {
    name: 'pr-review',
    filename: 'pr-review.yml',
    description: 'Auto-review pull requests when opened.',
  },
  {
    name: 'implement-from-issue',
    filename: 'implement-from-issue.yml',
    description: 'Implement an issue when the `spex:implement` label is applied.',
  },
] as const;

export type WorkflowTemplateName = (typeof WORKFLOW_TEMPLATES)[number]['name'];

export class UnknownWorkflowTemplateError extends SpexError {
  constructor(name: string, available: readonly string[]) {
    super(`Unknown workflow template "${name}". Available: ${available.join(', ')}.`);
  }
}

export function listWorkflowTemplates(): readonly (typeof WORKFLOW_TEMPLATES)[number][] {
  return WORKFLOW_TEMPLATES;
}

export async function getWorkflowTemplate(name: WorkflowTemplateName | string): Promise<{
  name: string;
  filename: string;
  content: string;
}> {
  const meta = WORKFLOW_TEMPLATES.find((t) => t.name === name);
  if (!meta) {
    throw new UnknownWorkflowTemplateError(
      name,
      WORKFLOW_TEMPLATES.map((t) => t.name),
    );
  }
  const content = await readTemplateFile(meta.filename);
  return { name: meta.name, filename: meta.filename, content };
}

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Read a template file. Templates live under `templates/` at the package root
 * in two layouts:
 *  - source: `<pkg>/src/templates/registry.ts` → templates at `<pkg>/templates/`
 *    (two levels up).
 *  - dist:   `<pkg>/dist/index.js` (bundled) → templates copied to
 *    `<pkg>/dist/templates/` by tsup `onSuccess` (one level deep).
 * Try both so the same code works in tests, dev, and the published package.
 */
async function readTemplateFile(filename: string): Promise<string> {
  const candidates = [
    join(here, '..', '..', 'templates', filename),
    join(here, 'templates', filename),
  ];
  let lastError: unknown;
  for (const path of candidates) {
    try {
      return await readFile(path, 'utf8');
    } catch (cause) {
      lastError = cause;
    }
  }
  throw new SpexError(
    `Workflow template "${filename}" not found in any of: ${candidates.join(', ')}. ` +
      `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
