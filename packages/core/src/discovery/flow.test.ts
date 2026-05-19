import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpexError } from '../errors.js';

const { mockInput, mockSelect } = vi.hoisted(() => ({
  mockInput: vi.fn(),
  mockSelect: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  input: mockInput,
  select: mockSelect,
}));

const { runDiscovery } = await import('./flow.js');

describe('runDiscovery', () => {
  beforeEach(() => {
    mockInput.mockReset();
    mockSelect.mockReset();
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
});
