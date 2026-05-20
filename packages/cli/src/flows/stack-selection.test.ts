import type { LLMProvider } from '@spex/core';
import type { StackRecommendations } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import {
  type BrainstormUserReply,
  StackSelectionCancelled,
  type StackSelectionPrompts,
  runStackSelection,
} from './stack-selection.js';

function llmReturning(responses: StackRecommendations[]): LLMProvider {
  let i = 0;
  return {
    generateStructured: vi.fn(async () => {
      const next = responses[i++] ?? responses[responses.length - 1];
      return next as never;
    }),
  };
}

function silentLogger() {
  return { log: vi.fn() };
}

const baseRec: StackRecommendations = {
  recommendations: [
    {
      rank: 1,
      label: 'Next.js + Postgres + Drizzle',
      components: [
        { role: 'framework', choice: 'Next.js 15', rationale: 'SSR' },
        { role: 'database', choice: 'Postgres', rationale: 'Relational' },
      ],
      tradeoffs: ['Vendor coupling to Vercel'],
      confidence: 'high',
      requirementsCovered: ['web SaaS', 'relational data'],
      requirementsUnaddressed: [],
    },
    {
      rank: 2,
      label: 'Remix + Postgres',
      components: [{ role: 'framework', choice: 'Remix', rationale: 'Forms' }],
      tradeoffs: [],
      confidence: 'medium',
      requirementsCovered: ['web SaaS'],
      requirementsUnaddressed: [],
    },
  ],
  unmappedRequirements: [],
};

describe('runStackSelection: no-preference', () => {
  it('returns the user-picked recommendation as a recommended-source decision', async () => {
    const llm = llmReturning([baseRec]);
    const prompts: StackSelectionPrompts = {
      pickRecommendation: vi.fn().mockResolvedValue({ rank: 1 }),
      acknowledgeValidation: vi.fn(),
      brainstormRound: vi.fn(),
    };
    const decision = await runStackSelection({
      llm,
      projectName: 'demo',
      answers: { project_type: 'CRUD SaaS' },
      entry: { kind: 'no-preference' },
      prompts,
      logger: silentLogger(),
    });
    expect(decision.label).toBe('Next.js + Postgres + Drizzle');
    expect(decision.source).toBe('recommended');
    expect(decision.tradeoffs).toContain('Vendor coupling to Vercel');
    expect(decision.validationWarnings).toEqual([]);
  });

  it('routes to brainstorm when the user picks that option', async () => {
    const llm = llmReturning([baseRec, baseRec]);
    let brainstormCalls = 0;
    const prompts: StackSelectionPrompts = {
      pickRecommendation: vi.fn().mockResolvedValue({ brainstorm: true }),
      acknowledgeValidation: vi.fn(),
      brainstormRound: vi.fn().mockImplementation(async (): Promise<BrainstormUserReply> => {
        brainstormCalls += 1;
        return { kind: 'accept' };
      }),
    };
    const decision = await runStackSelection({
      llm,
      projectName: 'demo',
      answers: {},
      entry: { kind: 'no-preference' },
      prompts,
      logger: silentLogger(),
    });
    expect(decision.source).toBe('brainstormed');
    expect(brainstormCalls).toBe(1);
  });
});

describe('runStackSelection: partial-constraints', () => {
  it('forwards the constraint to the recommender and never violates it', async () => {
    const llm = llmReturning([baseRec]);
    const prompts: StackSelectionPrompts = {
      pickRecommendation: vi.fn().mockResolvedValue({ rank: 1 }),
      acknowledgeValidation: vi.fn(),
      brainstormRound: vi.fn(),
    };
    const decision = await runStackSelection({
      llm,
      projectName: 'demo',
      answers: { project_type: 'CRUD SaaS' },
      entry: { kind: 'partial-constraints', constraints: 'must use Postgres' },
      prompts,
      logger: silentLogger(),
    });
    expect(decision.source).toBe('recommended');
    expect(decision.rationale).toContain('must use Postgres');
    const call = (llm.generateStructured as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      userPrompt: string;
    };
    expect(call.userPrompt).toContain('must use Postgres');
    expect(call.userPrompt).toContain('Explicit user constraints');
  });
});

describe('runStackSelection: explicit-choice', () => {
  const explicitRec: StackRecommendations = {
    recommendations: [
      {
        rank: 1,
        label: 'Next.js + Supabase',
        components: [
          { role: 'framework', choice: 'Next.js 15', rationale: 'SSR' },
          { role: 'database', choice: 'Supabase', rationale: 'Hosted Postgres + auth' },
        ],
        tradeoffs: ['Supabase pricing scales sharply'],
        confidence: 'medium',
        requirementsCovered: ['web SaaS'],
        requirementsUnaddressed: ['offline-first sync'],
      },
    ],
    unmappedRequirements: [],
  };

  it('records the choice as user-sourced when no warnings surface', async () => {
    const primary = explicitRec.recommendations[0];
    if (!primary) throw new Error('test fixture missing primary recommendation');
    const clean: StackRecommendations = {
      ...explicitRec,
      recommendations: [{ ...primary, requirementsUnaddressed: [] }],
    };
    const llm = llmReturning([clean]);
    const prompts: StackSelectionPrompts = {
      pickRecommendation: vi.fn(),
      acknowledgeValidation: vi.fn(),
      brainstormRound: vi.fn(),
    };
    const decision = await runStackSelection({
      llm,
      projectName: 'demo',
      answers: {},
      entry: { kind: 'explicit-choice', choice: 'Next.js + Supabase' },
      prompts,
      logger: silentLogger(),
    });
    expect(decision.source).toBe('user');
    expect(decision.validationWarnings).toEqual([]);
  });

  it('surfaces validation warnings but still permits the choice when user confirms', async () => {
    const llm = llmReturning([explicitRec]);
    const ack = vi.fn().mockResolvedValue(true);
    const prompts: StackSelectionPrompts = {
      pickRecommendation: vi.fn(),
      acknowledgeValidation: ack,
      brainstormRound: vi.fn(),
    };
    const decision = await runStackSelection({
      llm,
      projectName: 'demo',
      answers: { offline_first: true },
      entry: { kind: 'explicit-choice', choice: 'Next.js + Supabase' },
      prompts,
      logger: silentLogger(),
    });
    expect(decision.source).toBe('user');
    expect(decision.validationWarnings).toContain('offline-first sync');
    expect(ack).toHaveBeenCalledOnce();
  });

  it('aborts when the user rejects the choice after seeing warnings', async () => {
    const llm = llmReturning([explicitRec]);
    const prompts: StackSelectionPrompts = {
      pickRecommendation: vi.fn(),
      acknowledgeValidation: vi.fn().mockResolvedValue(false),
      brainstormRound: vi.fn(),
    };
    await expect(
      runStackSelection({
        llm,
        projectName: 'demo',
        answers: {},
        entry: { kind: 'explicit-choice', choice: 'Next.js + Supabase' },
        prompts,
        logger: silentLogger(),
      }),
    ).rejects.toBeInstanceOf(StackSelectionCancelled);
  });
});

describe('runStackSelection: brainstorm', () => {
  it('converges after a refine + accept round and produces a brainstormed-source decision', async () => {
    const basePrimary = baseRec.recommendations[0];
    if (!basePrimary) throw new Error('test fixture missing primary recommendation');
    const round1: StackRecommendations = {
      recommendations: [{ ...basePrimary, label: 'Next.js + Postgres' }],
      unmappedRequirements: [],
    };
    const round2: StackRecommendations = {
      recommendations: [{ ...basePrimary, label: 'SvelteKit + Drizzle + Turso' }],
      unmappedRequirements: [],
    };
    const llm = llmReturning([round1, round2]);
    const replies: BrainstormUserReply[] = [
      { kind: 'refine', feedback: 'I want SvelteKit instead' },
      { kind: 'accept' },
    ];
    const prompts: StackSelectionPrompts = {
      pickRecommendation: vi.fn(),
      acknowledgeValidation: vi.fn(),
      brainstormRound: vi.fn().mockImplementation(async () => {
        const next = replies.shift();
        if (!next) throw new Error('test ran out of brainstorm replies');
        return next;
      }),
    };
    const decision = await runStackSelection({
      llm,
      projectName: 'demo',
      answers: {},
      entry: { kind: 'brainstorm' },
      prompts,
      logger: silentLogger(),
    });
    expect(decision.source).toBe('brainstormed');
    expect(decision.label).toBe('SvelteKit + Drizzle + Turso');
    const secondCall = (llm.generateStructured as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as {
      userPrompt: string;
    };
    expect(secondCall.userPrompt).toContain('SvelteKit');
    expect(secondCall.userPrompt).toContain('user feedback:');
  });

  it('aborts when brainstorm exceeds the round budget without acceptance', async () => {
    const llm = llmReturning([baseRec, baseRec, baseRec]);
    const prompts: StackSelectionPrompts = {
      pickRecommendation: vi.fn(),
      acknowledgeValidation: vi.fn(),
      brainstormRound: vi.fn().mockResolvedValue({ kind: 'refine', feedback: 'try again' }),
    };
    await expect(
      runStackSelection({
        llm,
        projectName: 'demo',
        answers: {},
        entry: { kind: 'brainstorm' },
        prompts,
        logger: silentLogger(),
        maxBrainstormRounds: 2,
      }),
    ).rejects.toBeInstanceOf(StackSelectionCancelled);
  });
});
