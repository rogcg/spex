import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Decision } from '@spex/schemas';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { LLMProvider } from '../llm/provider.js';
import { type DecisionAction, type DecisionPrompter, runProposalApproval } from './flow.js';
import { ProposalPausedError, loadProposalState } from './state.js';

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'project-type',
    order: 1,
    category: 'project',
    question: 'What is the project type?',
    proposal: 'SaaS web app',
    rationale: 'The discovery answers describe a multi-tenant browser-based product.',
    techSpecPath: 'project.type',
    confidence: 'high',
    status: 'pending',
    ...overrides,
  };
}

function scriptedPrompter(actions: DecisionAction[]): DecisionPrompter {
  let index = 0;
  return {
    promptDecision: async () => {
      const action = actions[index];
      if (!action) {
        throw new Error('Prompter ran out of scripted actions');
      }
      index += 1;
      return action;
    },
    emitDebate: () => {},
    emitInfo: () => {},
  };
}

const stubLLM: LLMProvider = {
  async generateStructured<T>(opts: { schema: z.ZodSchema<T> }): Promise<T> {
    // Should not be called in pure accept-only paths
    return opts.schema.parse({});
  },
};

describe('runProposalApproval', () => {
  it('accepts every decision in --auto mode and records audit entries', async () => {
    const audit: unknown[] = [];
    const decisions: Decision[] = [
      makeDecision({}),
      makeDecision({ id: 'project-description', order: 2, techSpecPath: 'project.description' }),
    ];
    const result = await runProposalApproval({
      llm: stubLLM,
      projectName: 'acme',
      decisions,
      prompter: scriptedPrompter([]),
      audit: {
        async write(entry) {
          audit.push(entry);
        },
      },
      auto: true,
    });
    expect(result.decisions.every((d) => d.status === 'accepted')).toBe(true);
    expect(result.decisions.every((d) => d.resolvedValue === d.proposal)).toBe(true);
    expect(audit).toHaveLength(2);
  });

  it('--auto --strict aborts on low-confidence decisions', async () => {
    const decisions: Decision[] = [makeDecision({ confidence: 'low' })];
    await expect(
      runProposalApproval({
        llm: stubLLM,
        projectName: 'acme',
        decisions,
        prompter: scriptedPrompter([]),
        auto: true,
        strict: true,
      }),
    ).rejects.toThrow(/low-confidence/);
  });

  it('processes a sequence of accept + modify + reject(revise)+ accept', async () => {
    const reviseLLM: LLMProvider = {
      async generateStructured<T>(opts: { schema: z.ZodSchema<T> }): Promise<T> {
        return opts.schema.parse({
          id: 'project-description',
          order: 2,
          category: 'project',
          question: 'Describe the product',
          proposal: 'Revised description',
          rationale: 'Updated based on user feedback.',
          techSpecPath: 'project.description',
          confidence: 'medium',
          status: 'modified',
        });
      },
    };
    const decisions: Decision[] = [
      makeDecision({}),
      makeDecision({
        id: 'project-description',
        order: 2,
        techSpecPath: 'project.description',
        proposal: 'Original description',
      }),
      makeDecision({
        id: 'rationale-overall',
        order: 3,
        category: 'rationale',
        techSpecPath: 'rationale',
        proposal: 'Original rationale long enough to satisfy minimum length.',
      }),
    ];
    const audit: { id: string; status: string; resolvedValue?: string }[] = [];
    const result = await runProposalApproval({
      llm: reviseLLM,
      projectName: 'acme',
      decisions,
      prompter: scriptedPrompter([
        { kind: 'accept' },
        { kind: 'reject', feedback: 'too short' },
        { kind: 'accept' },
        {
          kind: 'modify',
          value: 'User-specified rationale that easily exceeds 50 characters',
          note: 'preferred wording',
        },
      ]),
      audit: {
        async write(entry) {
          audit.push({
            id: entry.decisionId,
            status: entry.status,
            ...(entry.resolvedValue !== undefined ? { resolvedValue: entry.resolvedValue } : {}),
          });
        },
      },
    });
    expect(result.decisions[0]?.status).toBe('accepted');
    expect(result.decisions[1]?.status).toBe('accepted');
    expect(result.decisions[1]?.resolvedValue).toBe('Revised description');
    expect(result.decisions[2]?.status).toBe('modified');
    expect(result.decisions[2]?.resolvedValue).toContain('User-specified');
    expect(audit).toHaveLength(3);
  });

  it('pauses and persists scratch state on the [pause] action', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spex-proposal-'));
    const scratchPath = join(dir, 'proposal-state.yaml');
    try {
      const decisions: Decision[] = [
        makeDecision({}),
        makeDecision({ id: 'project-description', order: 2, techSpecPath: 'project.description' }),
      ];
      await expect(
        runProposalApproval({
          llm: stubLLM,
          projectName: 'acme',
          decisions,
          prompter: scriptedPrompter([{ kind: 'accept' }, { kind: 'pause' }]),
          scratchPath,
        }),
      ).rejects.toBeInstanceOf(ProposalPausedError);

      const state = await loadProposalState(scratchPath);
      expect(state.currentIndex).toBe(1);
      expect(state.decisions[0]?.status).toBe('accepted');
      expect(state.decisions[1]?.status).toBe('presented');
      const raw = await readFile(scratchPath, 'utf8');
      expect(raw).toContain('pausedAt:');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('explore → pick-alternative records the alternative as modified', async () => {
    const alternativesLLM: LLMProvider = {
      async generateStructured<T>(opts: { schema: z.ZodSchema<T> }): Promise<T> {
        return opts.schema.parse({
          alternatives: [
            { label: 'CLI tool', tradeoffs: 'no GUI but cheap to ship' },
            { label: 'Static site', tradeoffs: 'no backend' },
          ],
        });
      },
    };
    const decisions: Decision[] = [makeDecision({})];
    const result = await runProposalApproval({
      llm: alternativesLLM,
      projectName: 'acme',
      decisions,
      prompter: scriptedPrompter([
        { kind: 'explore' },
        { kind: 'pick-alternative', label: 'CLI tool' },
      ]),
    });
    expect(result.decisions[0]?.status).toBe('modified');
    expect(result.decisions[0]?.resolvedValue).toBe('CLI tool');
  });
});
