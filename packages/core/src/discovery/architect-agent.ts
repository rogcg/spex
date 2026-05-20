import { z } from 'zod';
import { SpexError } from '../errors.js';
import type { LLMProvider } from '../llm/provider.js';
import type { DiscoveryAnswerValue, Question } from './questions.js';

export interface DiscoveryHistoryEntry {
  readonly question: Question;
  readonly answer: DiscoveryAnswerValue;
}

export interface ArchitectAgent {
  seedQuestion(): Question;
  nextQuestion(history: readonly DiscoveryHistoryEntry[]): Promise<Question | null>;
}

export interface ArchitectAgentOptions {
  llm: LLMProvider;
  seed?: Question;
  maxQuestions?: number;
}

const DEFAULT_SEED: Question = {
  id: 'project_type',
  prompt: 'What kind of application are you building?',
  type: 'input',
};

const DEFAULT_MAX_QUESTIONS = 12;

const SYSTEM_PROMPT = `You are a software architect conducting an adaptive discovery interview for a new project.

Your role: ask one question at a time, with each question informed by previous answers, to gather the information needed to design and scaffold the user's project. The user's answers feed into a structured TechSpec describing the project.

## Question generation rules

- Ask exactly one question per turn.
- Each question must have: an \`id\` (snake_case identifier), a \`prompt\` (the question text shown to the user), a \`type\` (one of: input, select, multi-select, confirm), and \`choices\` (required and with at least 2 entries for select and multi-select).
- Choose the question type that best fits the answer space. Prefer \`select\` over \`input\` when there is a natural finite set of choices.
- Build on prior answers — don't repeat questions or ignore context.

## Standard concept keys

When asking about these well-known concepts, use these exact \`id\` values so the downstream TechSpec generator can locate the answers:

- \`project_type\` — what kind of application (free-form input)
- \`primary_users\` — who the users are (select recommended)
- \`expected_scale\` — first-year scale (select recommended)
- \`auth_requirements\` — authentication needs (select recommended)
- \`data_persistence\` — data storage needs (select recommended)

You may add additional questions with other ids for project-specific context (e.g., \`realtime_features\`, \`integrations_needed\`, \`compliance_constraints\`).

## Stop condition

Respond with \`{ "done": true }\` when you have gathered enough information to produce a complete TechSpec covering: project type, primary users, expected scale, auth, data persistence, plus any other context relevant to this specific project. Aim for 5-10 questions total.

If you are not done, respond with \`{ "done": false, "question": <Question> }\`.`;

const QuestionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9_]*$/, 'id must be snake_case'),
    prompt: z.string().min(1),
    type: z.enum(['input', 'select', 'multi-select', 'confirm']),
    choices: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (q) =>
      (q.type !== 'select' && q.type !== 'multi-select') ||
      (Array.isArray(q.choices) && q.choices.length >= 2),
    { message: 'select and multi-select questions must include at least 2 choices' },
  );

const NextQuestionResponseSchema = z.discriminatedUnion('done', [
  z.object({ done: z.literal(true) }),
  z.object({ done: z.literal(false), question: QuestionSchema }),
]);

export function createArchitectAgent(opts: ArchitectAgentOptions): ArchitectAgent {
  if (opts.maxQuestions !== undefined && opts.maxQuestions < 1) {
    throw new SpexError(`maxQuestions must be >= 1 (got ${opts.maxQuestions})`);
  }
  const seed = opts.seed ?? DEFAULT_SEED;
  const maxQuestions = opts.maxQuestions ?? DEFAULT_MAX_QUESTIONS;

  return {
    seedQuestion: () => seed,
    async nextQuestion(history) {
      if (history.length >= maxQuestions) {
        return null;
      }
      const response = await opts.llm.generateStructured({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: formatHistory(history),
        schema: NextQuestionResponseSchema,
      });
      if (response.done) {
        return null;
      }
      return toQuestion(response.question);
    },
  };
}

function toQuestion(parsed: z.infer<typeof QuestionSchema>): Question {
  // The zod-parsed shape has `choices: string[] | undefined`. With
  // `exactOptionalPropertyTypes`, that does not satisfy Question's optional
  // `choices?: readonly string[]`. Reassemble explicitly.
  if (parsed.choices === undefined) {
    return { id: parsed.id, prompt: parsed.prompt, type: parsed.type };
  }
  return {
    id: parsed.id,
    prompt: parsed.prompt,
    type: parsed.type,
    choices: parsed.choices,
  };
}

function formatHistory(history: readonly DiscoveryHistoryEntry[]): string {
  if (history.length === 0) {
    return 'No questions have been answered yet. Generate the first follow-up question.';
  }
  const lines = ['Discovery conversation so far:', ''];
  history.forEach((entry, i) => {
    lines.push(`${i + 1}. [${entry.question.id}] ${entry.question.prompt}`);
    lines.push(`   Answer: ${formatAnswer(entry.answer)}`);
  });
  lines.push('');
  lines.push('Generate the next question, or signal done if you have enough information.');
  return lines.join('\n');
}

function formatAnswer(value: DiscoveryAnswerValue): string {
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? '(none)' : value.join(', ');
  }
  return value;
}
