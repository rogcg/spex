import { type Question, SPRINT_1_QUESTIONS } from '../discovery/questions.js';

const baseById = new Map(SPRINT_1_QUESTIONS.map((q) => [q.id, q]));

function reuse(id: string): Question {
  const q = baseById.get(id);
  if (!q) {
    throw new Error(`Unknown discovery question id: ${id}`);
  }
  return q;
}

export const INIT_DESCRIPTION_QUESTION: Question = {
  id: 'description',
  prompt: 'Describe this project in one sentence:',
  type: 'input',
};

export const INIT_DISCOVERY_QUESTIONS: readonly Question[] = [
  reuse('project_type'),
  INIT_DESCRIPTION_QUESTION,
  reuse('primary_users'),
  reuse('expected_scale'),
  reuse('auth_requirements'),
  reuse('data_persistence'),
] as const;
