import type { NextCommandSuggestion } from '@spex/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STRINGS } from '../strings.js';
import { printNextSteps } from './next-steps.js';

describe('printNextSteps', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints nothing for an empty list', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printNextSteps([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('renders a header, aligned command column, reasons, and the hint', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const suggestions: NextCommandSuggestion[] = [
      { command: 'cd my-app', reason: 'Enter the directory' },
      { command: 'spex implement "<feature>"', reason: 'Build a feature' },
    ];

    printNextSteps(suggestions);

    const output = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain(STRINGS.nextSteps.header);
    expect(output).toContain(STRINGS.nextSteps.commandColumn);
    expect(output).toContain('cd my-app');
    expect(output).toContain('Build a feature');
    expect(output).toContain(STRINGS.nextSteps.hint);

    // The short command is padded to align with the longest command.
    const longest = 'spex implement "<feature>"'.length;
    const shortRow = log.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.includes('cd my-app') && line.includes('Enter the directory'));
    expect(shortRow).toBeDefined();
    expect(shortRow).toContain(`cd my-app${' '.repeat(longest - 'cd my-app'.length)}`);
  });
});
