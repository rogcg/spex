import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { SpexError } from '../errors.js';
import type { ArchitectAgent, ArchitectStep, GapAssessment } from './architect-agent.js';
import type { Question } from './questions.js';

const { mockInput, mockSelect, mockCheckbox, mockConfirm, mockSeparator } = vi.hoisted(() => ({
  mockInput: vi.fn(),
  mockSelect: vi.fn(),
  mockCheckbox: vi.fn(),
  mockConfirm: vi.fn(),
  mockSeparator: vi.fn().mockImplementation(function MockSeparator(this: { isSeparator: true }) {
    this.isSeparator = true;
    return this;
  }),
}));

vi.mock('@inquirer/prompts', () => ({
  input: mockInput,
  select: mockSelect,
  checkbox: mockCheckbox,
  confirm: mockConfirm,
  Separator: mockSeparator,
}));

const { DiscoveryPausedError, runAdaptiveDiscovery } = await import('./flow.js');

describe('runAdaptiveDiscovery', () => {
  beforeEach(() => {
    mockInput.mockReset();
    mockSelect.mockReset();
    mockCheckbox.mockReset();
    mockConfirm.mockReset();
  });

  function makeAgent(seed: Question, steps: ArchitectStep[]): ArchitectAgent {
    const nextStep = vi.fn<ArchitectAgent['nextStep']>();
    for (const step of steps) {
      nextStep.mockResolvedValueOnce(step);
    }
    return { seedQuestion: () => seed, nextStep };
  }

  const completeGap: GapAssessment = {
    status: 'complete',
    missing: [],
    rationale: 'Done.',
  };

  it('drives multiple questions and returns answers + gap on complete', async () => {
    mockInput.mockResolvedValueOnce('task tracker');
    mockSelect.mockResolvedValueOnce('Consumers (B2C)');

    const seed: Question = { id: 'project_type', prompt: 'What?', type: 'input' };
    const followUp: Question = {
      id: 'primary_users',
      prompt: 'Who?',
      type: 'select',
      choices: ['Consumers (B2C)', 'Businesses'],
    };

    const agent = makeAgent(seed, [
      { type: 'question', question: followUp },
      { type: 'done', gap: completeGap },
    ]);

    const result = await runAdaptiveDiscovery({ agent });

    expect(result.answers).toEqual({
      project_type: 'task tracker',
      primary_users: 'Consumers (B2C)',
    });
    expect(result.gap).toEqual(completeGap);
    expect(result.override).toBeUndefined();
  });

  it('returns only the seed answer when the agent immediately signals done', async () => {
    mockInput.mockResolvedValueOnce('just the seed');
    const agent = makeAgent({ id: 'seed', prompt: '?', type: 'input' }, [
      { type: 'done', gap: completeGap },
    ]);

    const result = await runAdaptiveDiscovery({ agent });
    expect(result.answers).toEqual({ seed: 'just the seed' });
    expect(result.gap).toEqual(completeGap);
  });

  it('preserves multi-select array and confirm boolean answers', async () => {
    mockInput.mockResolvedValueOnce('app');
    mockCheckbox.mockResolvedValueOnce(['Auth', 'Realtime']);
    mockConfirm.mockResolvedValueOnce(false);

    const agent = makeAgent({ id: 'project_type', prompt: '?', type: 'input' }, [
      {
        type: 'question',
        question: {
          id: 'features',
          prompt: 'Pick features',
          type: 'multi-select',
          choices: ['Auth', 'Realtime', 'Uploads'],
        },
      },
      { type: 'question', question: { id: 'needs_db', prompt: 'DB?', type: 'confirm' } },
      { type: 'done', gap: completeGap },
    ]);

    const result = await runAdaptiveDiscovery({ agent });

    expect(result.answers).toEqual({
      project_type: 'app',
      features: ['Auth', 'Realtime'],
      needs_db: false,
    });
    expect(result.gap.status).toBe('complete');
  });

  it('returns the nice_to_have_missing gap without prompting the user', async () => {
    mockInput.mockResolvedValueOnce('app');
    const niceGap: GapAssessment = {
      status: 'nice_to_have_missing',
      missing: ['deployment target'],
      rationale: 'Core info present.',
    };
    const agent = makeAgent({ id: 'project_type', prompt: '?', type: 'input' }, [
      { type: 'done', gap: niceGap },
    ]);
    const confirmHook = vi.fn();

    const result = await runAdaptiveDiscovery({ agent, confirmCriticalGap: confirmHook });

    expect(result.gap).toEqual(niceGap);
    expect(result.override).toBeUndefined();
    expect(confirmHook).not.toHaveBeenCalled();
  });

  it('asks the user via confirmCriticalGap on critical_missing and records override when accepted', async () => {
    mockInput.mockResolvedValueOnce('app');
    const criticalGap: GapAssessment = {
      status: 'critical_missing',
      missing: ['primary_users'],
      rationale: 'User skipped this.',
    };
    const agent = makeAgent({ id: 'project_type', prompt: '?', type: 'input' }, [
      { type: 'done', gap: criticalGap },
    ]);
    const confirmHook = vi.fn().mockResolvedValueOnce(true);

    const result = await runAdaptiveDiscovery({ agent, confirmCriticalGap: confirmHook });

    expect(confirmHook).toHaveBeenCalledWith(criticalGap);
    expect(result.gap).toEqual(criticalGap);
    expect(result.override).toBeDefined();
    expect(result.override?.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws SpexError when the user rejects a critical gap', async () => {
    mockInput.mockResolvedValueOnce('app');
    const criticalGap: GapAssessment = {
      status: 'critical_missing',
      missing: ['primary_users', 'auth_requirements'],
      rationale: 'Two skipped.',
    };
    const agent = makeAgent({ id: 'project_type', prompt: '?', type: 'input' }, [
      { type: 'done', gap: criticalGap },
    ]);
    const confirmHook = vi.fn().mockResolvedValueOnce(false);

    await expect(runAdaptiveDiscovery({ agent, confirmCriticalGap: confirmHook })).rejects.toThrow(
      SpexError,
    );
  });
});

describe('runAdaptiveDiscovery (with navigation)', () => {
  let dir: string;

  beforeEach(async () => {
    mockInput.mockReset();
    mockSelect.mockReset();
    mockCheckbox.mockReset();
    mockConfirm.mockReset();
    dir = await mkdtemp(join(tmpdir(), 'spex-nav-adaptive-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const completeGap: GapAssessment = {
    status: 'complete',
    missing: [],
    rationale: 'Done.',
  };

  function makeAgent(seed: Question, steps: ArchitectStep[]): ArchitectAgent {
    const nextStep = vi.fn<ArchitectAgent['nextStep']>();
    for (const step of steps) {
      nextStep.mockResolvedValueOnce(step);
    }
    return { seedQuestion: () => seed, nextStep };
  }

  it('skip pushes a SKIPPED marker and excludes the id from final answers', async () => {
    mockInput.mockResolvedValueOnce('/skip'); // skip the seed
    const seed: Question = { id: 'seed', prompt: 'Seed?', type: 'input' };
    const followUp: Question = { id: 'next_q', prompt: 'Next?', type: 'input' };
    mockInput.mockResolvedValueOnce('the-answer');

    const agent = makeAgent(seed, [
      { type: 'question', question: followUp },
      { type: 'done', gap: completeGap },
    ]);

    const result = await runAdaptiveDiscovery({ agent, nav: {} });
    expect(result.answers).toEqual({ next_q: 'the-answer' });
    expect(result.answers.seed).toBeUndefined();
  });

  it('back pops the last history entry and re-asks that question', async () => {
    const seed: Question = { id: 'seed', prompt: 'Seed?', type: 'input' };
    const followUp: Question = { id: 'next_q', prompt: 'Next?', type: 'input' };

    mockInput
      .mockResolvedValueOnce('seed-answer') // answer seed
      .mockResolvedValueOnce('/back') // on next_q, go back
      .mockResolvedValueOnce('updated-seed') // re-answer seed
      .mockResolvedValueOnce('next-answer'); // answer next_q

    const agent: ArchitectAgent = {
      seedQuestion: () => seed,
      nextStep: vi
        .fn<ArchitectAgent['nextStep']>()
        .mockResolvedValueOnce({ type: 'question', question: followUp })
        .mockResolvedValueOnce({ type: 'question', question: followUp })
        .mockResolvedValueOnce({ type: 'done', gap: completeGap }),
    };

    const result = await runAdaptiveDiscovery({ agent, nav: {} });
    expect(result.answers).toEqual({ seed: 'updated-seed', next_q: 'next-answer' });
  });

  it('pause persists state and throws DiscoveryPausedError', async () => {
    const scratchPath = join(dir, 'scratch.yaml');
    const seed: Question = { id: 'seed', prompt: 'Seed?', type: 'input' };

    mockInput.mockResolvedValueOnce('seed-answer').mockResolvedValueOnce('/pause');

    const agent: ArchitectAgent = {
      seedQuestion: () => seed,
      nextStep: vi.fn<ArchitectAgent['nextStep']>().mockResolvedValueOnce({
        type: 'question',
        question: { id: 'q2', prompt: 'Q2?', type: 'input' },
      }),
    };

    await expect(runAdaptiveDiscovery({ agent, nav: { scratchPath } })).rejects.toBeInstanceOf(
      DiscoveryPausedError,
    );

    const written = await readFile(scratchPath, 'utf8');
    const state = parseYaml(written);
    expect(state.source).toBe('adaptive');
    expect(state.history).toEqual([
      { question: { id: 'seed', prompt: 'Seed?', type: 'input' }, answer: 'seed-answer' },
    ]);
  });
});
