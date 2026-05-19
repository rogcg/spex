import { input, select } from '@inquirer/prompts';
import { SpexError } from '../errors.js';
import { type DiscoveryAnswers, type Question, SPRINT_1_QUESTIONS } from './questions.js';

export async function runDiscovery(
  questions: readonly Question[] = SPRINT_1_QUESTIONS,
): Promise<DiscoveryAnswers> {
  const answers: DiscoveryAnswers = {};

  for (const question of questions) {
    answers[question.id] = await askQuestion(question);
  }

  return answers;
}

async function askQuestion(question: Question): Promise<string> {
  if (question.type === 'select') {
    const choices = question.choices;
    if (!choices || choices.length === 0) {
      throw new SpexError(`Select question "${question.id}" is missing choices`);
    }
    return select({
      message: question.prompt,
      choices: choices.map((choice) => ({ value: choice })),
    });
  }
  return input({ message: question.prompt });
}
