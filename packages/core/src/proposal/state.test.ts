import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProposalState } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProposalState, saveProposalState } from './state.js';

describe('proposal state persistence', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spex-proposal-state-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a proposal state to disk', async () => {
    const path = join(dir, 'nested', 'proposal-state.yaml');
    const state: ProposalState = {
      version: 1,
      pausedAt: '2026-05-20T10:00:00.000Z',
      projectName: 'acme',
      decisions: [
        {
          id: 'project-type',
          order: 1,
          category: 'project',
          question: 'What is the project type?',
          proposal: 'SaaS web app',
          rationale: 'Discovery matches a SaaS product.',
          techSpecPath: 'project.type',
          confidence: 'high',
          status: 'accepted',
          resolvedValue: 'SaaS web app',
        },
      ],
      currentIndex: 1,
    };
    await saveProposalState(path, state);
    const loaded = await loadProposalState(path);
    expect(loaded).toEqual(state);
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('projectName: acme');
  });

  it('rejects an invalid state file', async () => {
    const path = join(dir, 'broken.yaml');
    await saveProposalState(path, {
      version: 1,
      pausedAt: '2026-05-20T10:00:00.000Z',
      projectName: 'acme',
      decisions: [],
      currentIndex: 0,
    });
    // Corrupt the file
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, 'version: 2\n', 'utf8');
    await expect(loadProposalState(path)).rejects.toThrow(/Invalid proposal state/);
  });
});
