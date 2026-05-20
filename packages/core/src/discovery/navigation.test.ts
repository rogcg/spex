import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type NavContext, askQuestionWithNav } from './navigation.js';
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

const fullContext: NavContext = { canBack: true, canPause: true };

beforeEach(() => {
  mockInput.mockReset();
  mockSelect.mockReset();
  mockCheckbox.mockReset();
  mockConfirm.mockReset();
});

describe('askQuestionWithNav: input', () => {
  const inputQ: Question = { id: 'q1', prompt: 'What?', type: 'input' };

  it('returns the answer when the user types a normal value', async () => {
    mockInput.mockResolvedValueOnce('a task tracker');
    const result = await askQuestionWithNav(inputQ, fullContext);
    expect(result).toEqual({ type: 'answer', value: 'a task tracker' });
  });

  it('parses /why as a nav command', async () => {
    mockInput.mockResolvedValueOnce('/why');
    expect(await askQuestionWithNav(inputQ, fullContext)).toEqual({
      type: 'nav',
      command: 'why',
    });
  });

  it.each([
    ['/w', 'why'],
    ['/s', 'skip'],
    ['/b', 'back'],
    ['/p', 'pause'],
    ['/?', 'help'],
    ['/help', 'help'],
    ['/SKIP', 'skip'],
  ])('parses %s as nav command %s', async (raw, expected) => {
    mockInput.mockResolvedValueOnce(raw);
    expect(await askQuestionWithNav(inputQ, fullContext)).toEqual({
      type: 'nav',
      command: expected,
    });
  });

  it('treats strings without a / prefix as answers', async () => {
    mockInput.mockResolvedValueOnce('why bother');
    expect(await askQuestionWithNav(inputQ, fullContext)).toEqual({
      type: 'answer',
      value: 'why bother',
    });
  });

  it('appends a hint with available commands to the input message', async () => {
    mockInput.mockResolvedValueOnce('x');
    await askQuestionWithNav(inputQ, fullContext);
    const args = mockInput.mock.calls[0]?.[0] as { message: string };
    expect(args.message).toContain('What?');
    expect(args.message).toMatch(/\/why/);
    expect(args.message).toMatch(/\/back/);
    expect(args.message).toMatch(/\/pause/);
  });

  it('omits /back from the hint when canBack is false', async () => {
    mockInput.mockResolvedValueOnce('x');
    await askQuestionWithNav(inputQ, { canBack: false, canPause: true });
    const args = mockInput.mock.calls[0]?.[0] as { message: string };
    expect(args.message).not.toMatch(/\/back/);
  });
});

describe('askQuestionWithNav: select', () => {
  const selectQ: Question = {
    id: 'q1',
    prompt: 'Who?',
    type: 'select',
    choices: ['Consumers', 'Businesses'],
  };

  it('returns the selected choice as an answer', async () => {
    mockSelect.mockResolvedValueOnce('Consumers');
    expect(await askQuestionWithNav(selectQ, fullContext)).toEqual({
      type: 'answer',
      value: 'Consumers',
    });
  });

  it('returns a nav command when a nav choice is picked', async () => {
    mockSelect.mockResolvedValueOnce('__nav__skip');
    expect(await askQuestionWithNav(selectQ, fullContext)).toEqual({
      type: 'nav',
      command: 'skip',
    });
  });

  it('includes all available nav choices in the prompt', async () => {
    mockSelect.mockResolvedValueOnce('Consumers');
    await askQuestionWithNav(selectQ, fullContext);
    const args = mockSelect.mock.calls[0]?.[0] as {
      choices: Array<{ value?: string; name?: string }>;
    };
    const navValues = args.choices
      .map((c) => c.value)
      .filter((v): v is string => typeof v === 'string' && v.startsWith('__nav__'));
    expect(navValues).toEqual([
      '__nav__why',
      '__nav__back',
      '__nav__skip',
      '__nav__pause',
      '__nav__help',
    ]);
  });

  it('excludes /back from nav choices when canBack is false', async () => {
    mockSelect.mockResolvedValueOnce('Consumers');
    await askQuestionWithNav(selectQ, { canBack: false, canPause: true });
    const args = mockSelect.mock.calls[0]?.[0] as {
      choices: Array<{ value?: string }>;
    };
    const navValues = args.choices
      .map((c) => c.value)
      .filter((v): v is string => typeof v === 'string' && v.startsWith('__nav__'));
    expect(navValues).not.toContain('__nav__back');
  });
});

describe('askQuestionWithNav: multi-select', () => {
  const msQ: Question = {
    id: 'features',
    prompt: 'Pick features',
    type: 'multi-select',
    choices: ['Auth', 'Realtime'],
  };

  it('runs the pre-menu and then the actual checkbox when Answer is picked', async () => {
    mockSelect.mockResolvedValueOnce('__answer__');
    mockCheckbox.mockResolvedValueOnce(['Auth']);
    const result = await askQuestionWithNav(msQ, fullContext);
    expect(result).toEqual({ type: 'answer', value: ['Auth'] });
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockCheckbox).toHaveBeenCalledTimes(1);
  });

  it('returns a nav command from the pre-menu without invoking checkbox', async () => {
    mockSelect.mockResolvedValueOnce('__nav__why');
    const result = await askQuestionWithNav(msQ, fullContext);
    expect(result).toEqual({ type: 'nav', command: 'why' });
    expect(mockCheckbox).not.toHaveBeenCalled();
  });
});

describe('askQuestionWithNav: confirm', () => {
  const confirmQ: Question = { id: 'dec', prompt: 'Need a DB?', type: 'confirm' };

  it('runs the pre-menu and then the confirm when Answer is picked', async () => {
    mockSelect.mockResolvedValueOnce('__answer__');
    mockConfirm.mockResolvedValueOnce(true);
    const result = await askQuestionWithNav(confirmQ, fullContext);
    expect(result).toEqual({ type: 'answer', value: true });
  });

  it('returns a nav command from the pre-menu without invoking confirm', async () => {
    mockSelect.mockResolvedValueOnce('__nav__pause');
    const result = await askQuestionWithNav(confirmQ, fullContext);
    expect(result).toEqual({ type: 'nav', command: 'pause' });
    expect(mockConfirm).not.toHaveBeenCalled();
  });
});
