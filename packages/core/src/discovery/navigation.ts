import { Separator, checkbox, confirm, input, select } from '@inquirer/prompts';
import { SpexError } from '../errors.js';
import type { DiscoveryAnswerValue, Question } from './questions.js';

export type NavCommand = 'why' | 'skip' | 'back' | 'pause' | 'help';

/**
 * Marker placed in DiscoveryAnswers / history when the user skips a question.
 * Excluded from the final answers result.
 */
export const SKIPPED_MARKER = '__SKIPPED__';

export interface NavContext {
  /** Whether `back` is available (false when at the seed/first question). */
  canBack: boolean;
  /** Whether `pause` is available (false when no scratchPath is configured). */
  canPause: boolean;
}

export type AskResult =
  | { type: 'answer'; value: DiscoveryAnswerValue }
  | { type: 'nav'; command: NavCommand };

const NAV_PREFIX = '/';
const NAV_ALIASES: Record<string, NavCommand> = {
  w: 'why',
  why: 'why',
  s: 'skip',
  skip: 'skip',
  b: 'back',
  back: 'back',
  p: 'pause',
  pause: 'pause',
  '?': 'help',
  h: 'help',
  help: 'help',
};

const NAV_CHOICE_PREFIX = '__nav__';

/**
 * Build the list of nav choice descriptors (in display order) given the
 * current context. The `value` strings are prefixed with `__nav__` so they
 * can be distinguished from real answer choices in a select response.
 */
function navChoices(context: NavContext): Array<{ value: string; name: string }> {
  const choices: Array<{ value: string; name: string }> = [];
  choices.push({ value: `${NAV_CHOICE_PREFIX}why`, name: 'Why this question?' });
  if (context.canBack) {
    choices.push({ value: `${NAV_CHOICE_PREFIX}back`, name: 'Back to previous question' });
  }
  choices.push({ value: `${NAV_CHOICE_PREFIX}skip`, name: 'Skip this question' });
  if (context.canPause) {
    choices.push({ value: `${NAV_CHOICE_PREFIX}pause`, name: 'Pause and save state' });
  }
  choices.push({ value: `${NAV_CHOICE_PREFIX}help`, name: 'Help (list commands)' });
  return choices;
}

function parseNavInput(raw: string): NavCommand | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(NAV_PREFIX)) return null;
  const cmd = trimmed.slice(NAV_PREFIX.length).toLowerCase();
  return NAV_ALIASES[cmd] ?? null;
}

function parseNavChoice(value: string): NavCommand | null {
  if (!value.startsWith(NAV_CHOICE_PREFIX)) return null;
  const cmd = value.slice(NAV_CHOICE_PREFIX.length);
  return NAV_ALIASES[cmd] ?? null;
}

function requireChoices(question: Question): readonly string[] {
  const { choices } = question;
  if (!choices || choices.length === 0) {
    throw new SpexError(`${question.type} question "${question.id}" is missing choices`);
  }
  return choices;
}

/**
 * Ask a question with navigation commands enabled.
 *
 * - input: user can type `/cmd` (e.g. `/why`, `/skip`, `/back`, `/pause`, `/?`)
 *   instead of an answer.
 * - select: navigation choices are appended (after a separator) to the
 *   question's choices.
 * - confirm: nav is presented as a pre-step select menu (Answer this question /
 *   nav commands), then the actual yes/no prompt runs if Answer is chosen.
 * - multi-select: same pre-step menu pattern as confirm.
 */
export async function askQuestionWithNav(
  question: Question,
  context: NavContext,
): Promise<AskResult> {
  switch (question.type) {
    case 'input': {
      const message = `${question.prompt} ${formatInputHint(context)}`;
      const value = await input({ message });
      const cmd = parseNavInput(value);
      if (cmd) return { type: 'nav', command: cmd };
      return { type: 'answer', value };
    }
    case 'select': {
      const answerChoices = requireChoices(question).map((c) => ({ value: c, name: c }));
      const picked = (await select({
        message: question.prompt,
        choices: [...answerChoices, new Separator(), ...navChoices(context)],
      })) as string;
      const cmd = parseNavChoice(picked);
      if (cmd) return { type: 'nav', command: cmd };
      return { type: 'answer', value: picked };
    }
    case 'multi-select': {
      const menuChoices = [
        { value: '__answer__', name: 'Answer this question' },
        new Separator(),
        ...navChoices(context),
      ];
      const choice = (await select({
        message: question.prompt,
        choices: menuChoices,
      })) as string;
      if (choice === '__answer__') {
        const value = await checkbox({
          message: question.prompt,
          choices: requireChoices(question).map((c) => ({ value: c })),
        });
        return { type: 'answer', value };
      }
      const cmd = parseNavChoice(choice);
      if (cmd) return { type: 'nav', command: cmd };
      throw new SpexError(`Unexpected multi-select menu value: ${choice}`);
    }
    case 'confirm': {
      const menuChoices = [
        { value: '__answer__', name: 'Answer this question (yes/no)' },
        new Separator(),
        ...navChoices(context),
      ];
      const choice = (await select({
        message: question.prompt,
        choices: menuChoices,
      })) as string;
      if (choice === '__answer__') {
        const value = await confirm({ message: question.prompt });
        return { type: 'answer', value };
      }
      const cmd = parseNavChoice(choice);
      if (cmd) return { type: 'nav', command: cmd };
      throw new SpexError(`Unexpected confirm menu value: ${choice}`);
    }
  }
}

function formatInputHint(context: NavContext): string {
  const commands = ['/?'];
  commands.unshift('/skip', '/pause');
  if (context.canBack) commands.unshift('/back');
  commands.unshift('/why');
  return `(commands: ${commands.join(' ')})`;
}
