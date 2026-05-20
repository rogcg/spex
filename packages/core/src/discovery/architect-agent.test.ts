import { describe, expect, it, vi } from 'vitest';
import { SpexError } from '../errors.js';
import type { LLMProvider } from '../llm/provider.js';
import { type DiscoveryHistoryEntry, createArchitectAgent } from './architect-agent.js';
import type { Question } from './questions.js';

function makeLlm(impl?: LLMProvider['generateStructured']): LLMProvider {
  return { generateStructured: impl ?? vi.fn() };
}

describe('createArchitectAgent', () => {
  it('returns the provided seed question', () => {
    const seed: Question = { id: 'custom_seed', prompt: 'Custom?', type: 'input' };
    const agent = createArchitectAgent({ llm: makeLlm(), seed });
    expect(agent.seedQuestion()).toBe(seed);
  });

  it('uses a default seed when none is provided', () => {
    const agent = createArchitectAgent({ llm: makeLlm() });
    expect(agent.seedQuestion()).toEqual({
      id: 'project_type',
      prompt: expect.any(String),
      type: 'input',
    });
  });

  it('throws SpexError when maxQuestions is less than 1', () => {
    expect(() => createArchitectAgent({ llm: makeLlm(), maxQuestions: 0 })).toThrow(SpexError);
  });

  it('returns the LLM-generated question step when not done', async () => {
    const llmCall = vi.fn().mockResolvedValueOnce({
      done: false,
      question: {
        id: 'primary_users',
        prompt: 'Who uses it?',
        type: 'select',
        choices: ['Consumers', 'Businesses'],
      },
    });
    const agent = createArchitectAgent({ llm: makeLlm(llmCall) });
    const history: DiscoveryHistoryEntry[] = [
      {
        question: { id: 'project_type', prompt: 'What?', type: 'input' },
        answer: 'task tracker',
      },
    ];
    const step = await agent.nextStep(history);
    expect(step).toEqual({
      type: 'question',
      question: {
        id: 'primary_users',
        prompt: 'Who uses it?',
        type: 'select',
        choices: ['Consumers', 'Businesses'],
      },
    });
  });

  it('returns a done step with a complete gap assessment when the LLM signals done complete', async () => {
    const llmCall = vi.fn().mockResolvedValueOnce({
      done: true,
      gap: { status: 'complete', missing: [], rationale: 'All standard concepts covered.' },
    });
    const agent = createArchitectAgent({ llm: makeLlm(llmCall) });
    const step = await agent.nextStep([]);
    expect(step).toEqual({
      type: 'done',
      gap: {
        status: 'complete',
        missing: [],
        rationale: 'All standard concepts covered.',
      },
    });
  });

  it('returns a done step with a nice_to_have_missing gap assessment', async () => {
    const llmCall = vi.fn().mockResolvedValueOnce({
      done: true,
      gap: {
        status: 'nice_to_have_missing',
        missing: ['deployment target'],
        rationale: 'Core info present, deployment target not specified.',
      },
    });
    const agent = createArchitectAgent({ llm: makeLlm(llmCall) });
    const step = await agent.nextStep([]);
    expect(step).toEqual({
      type: 'done',
      gap: {
        status: 'nice_to_have_missing',
        missing: ['deployment target'],
        rationale: 'Core info present, deployment target not specified.',
      },
    });
  });

  it('returns a done step with a critical_missing gap assessment', async () => {
    const llmCall = vi.fn().mockResolvedValueOnce({
      done: true,
      gap: {
        status: 'critical_missing',
        missing: ['primary_users', 'data_persistence'],
        rationale: 'User repeatedly skipped these standard questions.',
      },
    });
    const agent = createArchitectAgent({ llm: makeLlm(llmCall) });
    const step = await agent.nextStep([]);
    expect(step).toEqual({
      type: 'done',
      gap: {
        status: 'critical_missing',
        missing: ['primary_users', 'data_persistence'],
        rationale: 'User repeatedly skipped these standard questions.',
      },
    });
  });

  it('returns a done step with the cap-reached gap when history hits maxQuestions', async () => {
    const llmCall = vi.fn();
    const agent = createArchitectAgent({ llm: makeLlm(llmCall), maxQuestions: 2 });
    const history: DiscoveryHistoryEntry[] = [
      { question: { id: 'a', prompt: '?', type: 'input' }, answer: 'x' },
      { question: { id: 'b', prompt: '?', type: 'input' }, answer: 'y' },
    ];
    const step = await agent.nextStep(history);
    expect(step.type).toBe('done');
    if (step.type === 'done') {
      expect(step.gap.status).toBe('nice_to_have_missing');
      expect(step.gap.missing.length).toBeGreaterThan(0);
    }
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('serializes prior answers (string, array, boolean) into the user prompt', async () => {
    const llmCall = vi.fn().mockResolvedValueOnce({
      done: true,
      gap: { status: 'complete', missing: [], rationale: 'Done.' },
    });
    const agent = createArchitectAgent({ llm: makeLlm(llmCall) });

    await agent.nextStep([
      { question: { id: 'a', prompt: 'A?', type: 'input' }, answer: 'hello' },
      {
        question: { id: 'b', prompt: 'B?', type: 'multi-select', choices: ['x', 'y'] },
        answer: ['x', 'y'],
      },
      { question: { id: 'c', prompt: 'C?', type: 'confirm' }, answer: true },
      { question: { id: 'd', prompt: 'D?', type: 'confirm' }, answer: false },
      {
        question: { id: 'e', prompt: 'E?', type: 'multi-select', choices: ['p', 'q'] },
        answer: [],
      },
    ]);

    const callArgs = llmCall.mock.calls[0]?.[0] as { userPrompt: string };
    expect(callArgs.userPrompt).toContain('Answer: hello');
    expect(callArgs.userPrompt).toContain('Answer: x, y');
    expect(callArgs.userPrompt).toContain('Answer: yes');
    expect(callArgs.userPrompt).toContain('Answer: no');
    expect(callArgs.userPrompt).toContain('Answer: (none)');
  });

  it('passes a non-empty system prompt to the LLM', async () => {
    const llmCall = vi.fn().mockResolvedValueOnce({
      done: true,
      gap: { status: 'complete', missing: [], rationale: 'Done.' },
    });
    const agent = createArchitectAgent({ llm: makeLlm(llmCall) });
    await agent.nextStep([]);
    const callArgs = llmCall.mock.calls[0]?.[0] as { systemPrompt: string };
    expect(callArgs.systemPrompt.length).toBeGreaterThan(50);
  });
});
