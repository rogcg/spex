import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { SpexError } from '../errors.js';

const DiscoveryAnswerValueSchema = z.union([z.string(), z.array(z.string()), z.boolean()]);

const QuestionStateSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  type: z.enum(['input', 'select', 'multi-select', 'confirm']),
  choices: z.array(z.string()).optional(),
  rationale: z.string().optional(),
});

const HistoryEntryStateSchema = z.object({
  question: QuestionStateSchema,
  answer: DiscoveryAnswerValueSchema,
});

export const DiscoveryStateSchema = z.object({
  version: z.literal(1),
  pausedAt: z.string().min(1),
  source: z.enum(['static', 'adaptive']),
  history: z.array(HistoryEntryStateSchema),
  skipped: z.array(z.string()),
});

export type DiscoveryState = z.infer<typeof DiscoveryStateSchema>;

export async function saveDiscoveryState(path: string, state: DiscoveryState): Promise<void> {
  const validated = DiscoveryStateSchema.parse(state);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyYaml(validated), 'utf8');
}

export async function loadDiscoveryState(path: string): Promise<DiscoveryState> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    throw new SpexError(`Could not read discovery state at ${path}`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new SpexError(`Could not parse YAML at ${path}`, { cause: error });
  }
  const result = DiscoveryStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new SpexError(`Invalid discovery state at ${path}: ${result.error.message}`);
  }
  return result.data;
}
