import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { SpexError } from '../errors.js';
import type { ArchitectAgent, DiscoveryHistoryEntry } from './architect-agent.js';
import {
  type DiscoveryAnswerValue,
  type DiscoveryAnswers,
  type Question,
  SPRINT_1_QUESTIONS,
} from './questions.js';

export async function runDiscovery(
  source: readonly Question[] | ArchitectAgent = SPRINT_1_QUESTIONS,
): Promise<DiscoveryAnswers> {
  if (isArchitectAgent(source)) {
    return runArchitectFlow(source);
  }
  return runStaticFlow(source);
}

function isArchitectAgent(source: readonly Question[] | ArchitectAgent): source is ArchitectAgent {
  return !Array.isArray(source);
}

async function runStaticFlow(questions: readonly Question[]): Promise<DiscoveryAnswers> {
  const answers: DiscoveryAnswers = {};
  for (const question of questions) {
    answers[question.id] = await askQuestion(question);
  }
  return answers;
}

async function runArchitectFlow(agent: ArchitectAgent): Promise<DiscoveryAnswers> {
  const history: DiscoveryHistoryEntry[] = [];
  let next: Question | null = agent.seedQuestion();
  while (next) {
    const answer = await askQuestion(next);
    history.push({ question: next, answer });
    // Pass a snapshot so the agent cannot mutate the canonical history.
    next = await agent.nextQuestion([...history]);
  }
  const answers: DiscoveryAnswers = {};
  for (const entry of history) {
    answers[entry.question.id] = entry.answer;
  }
  return answers;
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
