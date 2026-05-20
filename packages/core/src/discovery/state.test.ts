import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { SpexError } from '../errors.js';
import { type DiscoveryState, loadDiscoveryState, saveDiscoveryState } from './state.js';

describe('discovery state persistence', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spex-discovery-state-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const sampleState: DiscoveryState = {
    version: 1,
    pausedAt: '2026-05-19T12:34:56.789Z',
    source: 'adaptive',
    history: [
      {
        question: { id: 'project_type', prompt: 'What?', type: 'input' },
        answer: 'task tracker',
      },
      {
        question: {
          id: 'features',
          prompt: 'Pick features',
          type: 'multi-select',
          choices: ['Auth', 'Realtime'],
        },
        answer: ['Auth'],
      },
      {
        question: { id: 'needs_db', prompt: 'DB?', type: 'confirm' },
        answer: true,
      },
    ],
    skipped: ['some_skipped_id'],
  };

  it('saves and loads a round-trippable state', async () => {
    const path = join(dir, 'nested', 'discovery.yaml');
    await saveDiscoveryState(path, sampleState);

    const written = await readFile(path, 'utf8');
    const parsed = parseYaml(written);
    expect(parsed.version).toBe(1);

    const loaded = await loadDiscoveryState(path);
    expect(loaded).toEqual(sampleState);
  });

  it('creates parent directories on save', async () => {
    const path = join(dir, 'deep', 'nested', 'discovery.yaml');
    await saveDiscoveryState(path, sampleState);
    const loaded = await loadDiscoveryState(path);
    expect(loaded).toEqual(sampleState);
  });

  it('throws SpexError when the file is missing', async () => {
    await expect(loadDiscoveryState(join(dir, 'nope.yaml'))).rejects.toThrow(SpexError);
  });

  it('throws SpexError when the file is malformed YAML', async () => {
    const path = join(dir, 'bad.yaml');
    await saveDiscoveryState(path, sampleState);
    await readFile(path, 'utf8');
    // Overwrite with invalid YAML
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, ': : :', 'utf8');
    await expect(loadDiscoveryState(path)).rejects.toThrow(SpexError);
  });

  it('throws SpexError when the state schema does not validate', async () => {
    const { writeFile } = await import('node:fs/promises');
    const path = join(dir, 'invalid.yaml');
    await writeFile(path, 'version: 1\nsource: bogus\n', 'utf8');
    await expect(loadDiscoveryState(path)).rejects.toThrow(SpexError);
  });
});
