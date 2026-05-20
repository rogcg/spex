import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpexError } from '../errors.js';
import type { ArchitectAgent, ArchitectStep, GapAssessment } from './architect-agent.js';
import type { Question } from './questions.js';

const { mockInput, mockSelect, mockCheckbox, mockConfirm } = vi.hoisted(() => ({
  mockInput: vi.fn(),
  mockSelect: vi.fn(),
  mockCheckbox: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  input: mockInput,
  select: mockSelect,
  checkbox: mockCheckbox,
  confirm: mockConfirm,
}));

const { runDiscovery, runAdaptiveDiscovery } = await import('./flow.js');

describe('runDiscovery (static questions)', () => {
  beforeEach(() => {
    mockInput.mockReset();
    mockSelect.mockReset();
    mockCheckbox.mockReset();
    mockConfirm.mockReset();
  });

  it('asks every discovery question in order and returns answers keyed by id', async () => {
    mockInput.mockResolvedValueOnce('a task tracker');
    mockSelect
      .mockResolvedValueOnce('Consumers (B2C)')
      .mockResolvedValueOnce('100-1000 users')
      .mockResolvedValueOnce('Email/password only')
      .mockResolvedValueOnce('Relational database');

    const answers = await runDiscovery();

    expect(answers).toEqual({
      project_type: 'a task tracker',
      primary_users: 'Consumers (B2C)',
      expected_scale: '100-1000 users',
      auth_requirements: 'Email/password only',
      data_persistence: 'Relational database',
    });
    expect(mockInput).toHaveBeenCalledTimes(1);
    expect(mockSelect).toHaveBeenCalledTimes(4);
  });

  it('passes the prompt text to inquirer for input questions', async () => {
    mockInput.mockResolvedValueOnce('x');
    mockSelect.mockResolvedValue('a');

    await runDiscovery();

    expect(mockInput).toHaveBeenCalledWith({
      message: 'What kind of application are you building?',
    });
  });

  it('passes choices as { value } objects for select questions', async () => {
    mockInput.mockResolvedValueOnce('x');
    mockSelect.mockResolvedValue('a');

    await runDiscovery();

    expect(mockSelect).toHaveBeenNthCalledWith(1, {
      message: 'Who are the primary users?',
      choices: [
        { value: 'Consumers (B2C)' },
        { value: 'Small businesses (SMB)' },
        { value: 'Enterprise' },
        { value: 'Internal team' },
        { value: 'Developers' },
      ],
    });
  });

  it('accepts a custom question set', async () => {
    mockInput.mockResolvedValueOnce('hello');

    const answers = await runDiscovery([{ id: 'greeting', prompt: 'Say hi', type: 'input' }]);

    expect(answers).toEqual({ greeting: 'hello' });
    expect(mockInput).toHaveBeenCalledTimes(1);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('handles multi-select questions and returns the selected array', async () => {
    mockCheckbox.mockResolvedValueOnce(['A', 'B']);
    const answers = await runDiscovery([
      { id: 'features', prompt: 'Pick features', type: 'multi-select', choices: ['A', 'B', 'C'] },
    ]);
    expect(answers).toEqual({ features: ['A', 'B'] });
    expect(mockCheckbox).toHaveBeenCalledWith({
      message: 'Pick features',
      choices: [{ value: 'A' }, { value: 'B' }, { value: 'C' }],
    });
  });

  it('handles confirm questions and returns the boolean answer', async () => {
    mockConfirm.mockResolvedValueOnce(true);
    const answers = await runDiscovery([
      { id: 'wants_db', prompt: 'Need a database?', type: 'confirm' },
    ]);
    expect(answers).toEqual({ wants_db: true });
    expect(mockConfirm).toHaveBeenCalledWith({ message: 'Need a database?' });
  });

  it('throws SpexError when a select question is defined without choices', async () => {
    await expect(runDiscovery([{ id: 'bad', prompt: 'X', type: 'select' }])).rejects.toThrow(
      SpexError,
    );
  });

  it('throws SpexError when a select question has an empty choices array', async () => {
    await expect(
      runDiscovery([{ id: 'bad', prompt: 'X', type: 'select', choices: [] }]),
    ).rejects.toThrow(SpexError);
  });

  it('throws SpexError when a multi-select question is missing choices', async () => {
    await expect(runDiscovery([{ id: 'bad', prompt: 'X', type: 'multi-select' }])).rejects.toThrow(
      SpexError,
    );
  });
});

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
