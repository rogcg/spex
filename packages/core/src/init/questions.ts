import type { Question } from '../discovery/questions.js';

/**
 * Seed question for `spex init` adaptive discovery. The architect agent picks
 * up after the user answers this and drives the rest of the interview based
 * on the detected stack and the project's needs.
 */
export const INIT_DESCRIPTION_QUESTION: Question = {
  id: 'description',
  prompt: 'Describe this project in one sentence:',
  type: 'input',
};
