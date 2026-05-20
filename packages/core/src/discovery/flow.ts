import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { SpexError } from '../errors.js';
import type {
  ArchitectAgent,
  ArchitectStep,
  DiscoveryHistoryEntry,
  GapAssessment,
} from './architect-agent.js';
import {
  type DiscoveryAnswerValue,
  type DiscoveryAnswers,
  type Question,
  SPRINT_1_QUESTIONS,
} from './questions.js';

export interface DiscoveryResult {
  answers: DiscoveryAnswers;
  gap: GapAssessment;
  override?: { acceptedAt: string };
}

export interface RunAdaptiveDiscoveryOptions {
  agent: ArchitectAgent;
  /**
   * Optional confirmation hook for critical gaps. Defaults to an inquirer
   * `confirm` prompt asking the user whether to proceed anyway. Override in
   * tests or for non-interactive callers.
   */
  confirmCriticalGap?: (gap: GapAssessment) => Promise<boolean>;
}

export async function runDiscovery(
  questions: readonly Question[] = SPRINT_1_QUESTIONS,
): Promise<DiscoveryAnswers> {
  const answers: DiscoveryAnswers = {};
  for (const question of questions) {
    answers[question.id] = await askQuestion(question);
  }
  return answers;
}

export async function runAdaptiveDiscovery(
  options: RunAdaptiveDiscoveryOptions,
): Promise<DiscoveryResult> {
  const { agent } = options;
  const confirmCriticalGap = options.confirmCriticalGap ?? defaultConfirmCriticalGap;

  const history: DiscoveryHistoryEntry[] = [];
  let step: ArchitectStep = {
    type: 'question',
    question: agent.seedQuestion(),
  };
  while (step.type === 'question') {
    const answer = await askQuestion(step.question);
    history.push({ question: step.question, answer });
    step = await agent.nextStep([...history]);
  }

  const answers: DiscoveryAnswers = {};
  for (const entry of history) {
    answers[entry.question.id] = entry.answer;
  }

  const { gap } = step;
  if (gap.status === 'critical_missing') {
    const accepted = await confirmCriticalGap(gap);
    if (!accepted) {
      throw new SpexError(`Discovery cancelled: critical info missing (${gap.missing.join('; ')})`);
    }
    return {
      answers,
      gap,
      override: { acceptedAt: new Date().toISOString() },
    };
  }
  return { answers, gap };
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
