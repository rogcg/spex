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

  it('returns the LLM-generated question when not done', async () => {
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
    const next = await agent.nextQuestion(history);
    expect(next).toEqual({
      id: 'primary_users',
      prompt: 'Who uses it?',
      type: 'select',
      choices: ['Consumers', 'Businesses'],
    });
  });

  it('returns null when the LLM signals done', async () => {
    const llmCall = vi.fn().mockResolvedValueOnce({ done: true });
    const agent = createArchitectAgent({ llm: makeLlm(llmCall) });
    const next = await agent.nextQuestion([]);
    expect(next).toBeNull();
  });

  it('returns null and skips the LLM call when history reaches maxQuestions', async () => {
    const llmCall = vi.fn();
    const agent = createArchitectAgent({ llm: makeLlm(llmCall), maxQuestions: 2 });
    const history: DiscoveryHistoryEntry[] = [
      { question: { id: 'a', prompt: '?', type: 'input' }, answer: 'x' },
      { question: { id: 'b', prompt: '?', type: 'input' }, answer: 'y' },
    ];
    const next = await agent.nextQuestion(history);
    expect(next).toBeNull();
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('serializes prior answers (string, array, boolean) into the user prompt', async () => {
    const llmCall = vi.fn().mockResolvedValueOnce({ done: true });
    const agent = createArchitectAgent({ llm: makeLlm(llmCall) });

    await agent.nextQuestion([
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
    const llmCall = vi.fn().mockResolvedValueOnce({ done: true });
    const agent = createArchitectAgent({ llm: makeLlm(llmCall) });
    await agent.nextQuestion([]);
    const callArgs = llmCall.mock.calls[0]?.[0] as { systemPrompt: string };
    expect(callArgs.systemPrompt.length).toBeGreaterThan(50);
  });
});
