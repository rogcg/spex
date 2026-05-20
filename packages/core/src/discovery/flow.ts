import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { SpexError } from '../errors.js';
import type {
  ArchitectAgent,
  ArchitectStep,
  DiscoveryHistoryEntry,
  GapAssessment,
} from './architect-agent.js';
import {
  type AskResult,
  type NavCommand,
  type NavContext,
  SKIPPED_MARKER,
  askQuestionWithNav,
} from './navigation.js';
import type { DiscoveryAnswerValue, DiscoveryAnswers, Question } from './questions.js';
import { type DiscoveryState, saveDiscoveryState } from './state.js';

export interface DiscoveryResult {
  answers: DiscoveryAnswers;
  gap: GapAssessment;
  override?: { acceptedAt: string };
}

export interface NavigationOptions {
  /** Path to write paused state to. If unset, the `/pause` command is disabled. */
  scratchPath?: string;
}

export interface RunAdaptiveDiscoveryOptions {
  agent: ArchitectAgent;
  /**
   * Optional confirmation hook for critical gaps. Defaults to an inquirer
   * `confirm` prompt asking the user whether to proceed anyway.
   */
  confirmCriticalGap?: (gap: GapAssessment) => Promise<boolean>;
  /** Navigation commands (why/skip/back/pause/help). */
  nav?: NavigationOptions;
}

/**
 * Thrown when the user invokes `/pause`. State has already been written to
 * `nav.scratchPath` before this error fires. Callers should catch and exit
 * gracefully (the discovery flow can be resumed later).
 */
export class DiscoveryPausedError extends SpexError {
  readonly scratchPath: string;
  constructor(scratchPath: string) {
    super(`Discovery paused. State saved to ${scratchPath}.`);
    this.scratchPath = scratchPath;
  }
}

export async function runAdaptiveDiscovery(
  options: RunAdaptiveDiscoveryOptions,
): Promise<DiscoveryResult> {
  const { agent } = options;
  const confirmCriticalGap = options.confirmCriticalGap ?? defaultConfirmCriticalGap;

  const history: DiscoveryHistoryEntry[] = [];
  let step: ArchitectStep = { type: 'question', question: agent.seedQuestion() };

  while (step.type === 'question') {
    const q = step.question;
    if (options.nav) {
      const context: NavContext = {
        canBack: history.length > 0,
        canPause: options.nav.scratchPath !== undefined,
      };
      const result = await askQuestionWithNav(q, context);
      const handled = await handleAdaptiveStep({
        q,
        result,
        history,
        agent,
        nav: options.nav,
      });
      step = handled;
    } else {
      const answer = await askQuestion(q);
      history.push({ question: q, answer });
      step = await agent.nextStep([...history]);
    }
  }

  const answers = collectAnswers(history);
  const { gap } = step;
  if (gap.status === 'critical_missing') {
    const accepted = await confirmCriticalGap(gap);
    if (!accepted) {
      throw new SpexError(`Discovery cancelled: critical info missing (${gap.missing.join('; ')})`);
    }
    return { answers, gap, override: { acceptedAt: new Date().toISOString() } };
  }
  return { answers, gap };
}

async function handleAdaptiveStep(args: {
  q: Question;
  result: AskResult;
  history: DiscoveryHistoryEntry[];
  agent: ArchitectAgent;
  nav: NavigationOptions;
}): Promise<ArchitectStep> {
  const { q, result, history, agent, nav } = args;
  if (result.type === 'answer') {
    history.push({ question: q, answer: result.value });
    return agent.nextStep([...history]);
  }
  switch (result.command) {
    case 'why':
      emitWhy(q);
      return { type: 'question', question: q };
    case 'skip':
      history.push({ question: q, answer: SKIPPED_MARKER });
      return agent.nextStep([...history]);
    case 'back': {
      const popped = history.pop();
      if (popped) {
        return { type: 'question', question: popped.question };
      }
      return { type: 'question', question: q };
    }
    case 'pause':
      await persistAdaptivePause(nav, history);
      // Unreachable: persistAdaptivePause throws on success.
      return { type: 'question', question: q };
    case 'help':
      emitHelp({
        canBack: history.length > 0,
        canPause: nav.scratchPath !== undefined,
      });
      return { type: 'question', question: q };
  }
}

function collectAnswers(history: readonly DiscoveryHistoryEntry[]): DiscoveryAnswers {
  const answers: DiscoveryAnswers = {};
  for (const entry of history) {
    if (entry.answer === SKIPPED_MARKER) continue;
    answers[entry.question.id] = entry.answer;
  }
  return answers;
}

async function persistAdaptivePause(
  nav: NavigationOptions,
  history: readonly DiscoveryHistoryEntry[],
): Promise<void> {
  const path = nav.scratchPath;
  if (!path) throw new SpexError('Cannot pause: no scratchPath configured');
  const skipped = history.filter((e) => e.answer === SKIPPED_MARKER).map((e) => e.question.id);
  const state: DiscoveryState = {
    version: 1,
    pausedAt: new Date().toISOString(),
    source: 'adaptive',
    history: history.map((e) => ({
      question: questionToState(e.question),
      answer: e.answer,
    })),
    skipped,
  };
  await saveDiscoveryState(path, state);
  throw new DiscoveryPausedError(path);
}

function questionToState(question: Question): DiscoveryState['history'][number]['question'] {
  const base: DiscoveryState['history'][number]['question'] = {
    id: question.id,
    prompt: question.prompt,
    type: question.type,
  };
  const withChoices =
    question.choices !== undefined ? { ...base, choices: [...question.choices] } : base;
  return question.rationale !== undefined
    ? { ...withChoices, rationale: question.rationale }
    : withChoices;
}

function emitWhy(question: Question): void {
  const body = question.rationale
    ? question.rationale
    : 'No rationale was provided for this question.';
  process.stderr.write(`\n[why] ${body}\n\n`);
}

function emitHelp(context: NavContext): void {
  const lines = [
    '',
    'Navigation commands:',
    '  /why    Show the rationale for the current question',
    '  /skip   Skip the current question',
  ];
  if (context.canBack) lines.push('  /back   Return to the previous question');
  else lines.push('  /back   (unavailable — at the first question)');
  if (context.canPause) lines.push('  /pause  Save state and exit');
  else lines.push('  /pause  (unavailable — no scratchPath configured)');
  lines.push('  /?      Show this help (alias: /help)');
  lines.push('');
  process.stderr.write(`${lines.join('\n')}\n`);
}

async function defaultConfirmCriticalGap(gap: GapAssessment): Promise<boolean> {
  const missingList = gap.missing.map((m) => `  - ${m}`).join('\n');
  const message = [
    'Critical info is still missing:',
    missingList,
    '',
    `Rationale: ${gap.rationale}`,
    '',
    'Continue anyway?',
  ].join('\n');
  return confirm({ message, default: false });
}

async function askQuestion(question: Question): Promise<DiscoveryAnswerValue> {
  switch (question.type) {
    case 'input':
      return input({ message: question.prompt });
    case 'select':
      return select({
        message: question.prompt,
        choices: requireChoices(question).map((c) => ({ value: c })),
      });
    case 'multi-select':
      return checkbox({
        message: question.prompt,
        choices: requireChoices(question).map((c) => ({ value: c })),
      });
    case 'confirm':
      return confirm({ message: question.prompt });
  }
}

function requireChoices(question: Question): readonly string[] {
  const { choices } = question;
  if (!choices || choices.length === 0) {
    throw new SpexError(`${question.type} question "${question.id}" is missing choices`);
  }
  return choices;
}

// Re-export navigation types for consumers building custom flows.
export type { NavCommand, NavContext };
