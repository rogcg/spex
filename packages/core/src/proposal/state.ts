import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type ProposalState, ProposalStateSchema } from '@spex/schemas';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { SpexError } from '../errors.js';

export async function saveProposalState(path: string, state: ProposalState): Promise<void> {
  const validated = ProposalStateSchema.parse(state);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyYaml(validated), 'utf8');
}

export async function loadProposalState(path: string): Promise<ProposalState> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    throw new SpexError(`Could not read proposal state at ${path}`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new SpexError(`Could not parse YAML at ${path}`, { cause: error });
  }
  const result = ProposalStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new SpexError(`Invalid proposal state at ${path}: ${result.error.message}`);
  }
  return result.data;
}

export class ProposalPausedError extends SpexError {
  readonly scratchPath: string;
  constructor(scratchPath: string) {
    super(`Proposal paused. State saved to ${scratchPath}.`);
    this.scratchPath = scratchPath;
  }
}
