import { z } from 'zod';
import { SpexError } from '../errors.js';
import type { LLMProvider } from '../llm/provider.js';
import type { DiscoveryAnswerValue, Question } from './questions.js';

export interface DiscoveryHistoryEntry {
  readonly question: Question;
  readonly answer: DiscoveryAnswerValue;
}

export type GapStatus = 'complete' | 'nice_to_have_missing' | 'critical_missing';

export interface GapAssessment {
  status: GapStatus;
  missing: readonly string[];
  rationale: string;
}

export type ArchitectStep =
  | { type: 'question'; question: Question }
  | { type: 'done'; gap: GapAssessment };

export interface ArchitectAgent {
  seedQuestion(): Question;
  nextStep(history: readonly DiscoveryHistoryEntry[]): Promise<ArchitectStep>;
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
- Always include a \`rationale\` (one or two sentences) explaining why you are asking this specific question now, given the prior answers. The rationale is shown to the user if they invoke the \`/why\` navigation command.

## Standard concept keys

When asking about these well-known concepts, use these exact \`id\` values so the downstream TechSpec generator can locate the answers:

- \`project_type\` — what kind of application (free-form input)
- \`primary_users\` — who the users are (select recommended)
- \`expected_scale\` — first-year scale (select recommended)
- \`auth_requirements\` — authentication needs (select recommended)
- \`data_persistence\` — data storage needs (select recommended)

You may add additional questions with other ids for project-specific context (e.g., \`realtime_features\`, \`integrations_needed\`, \`compliance_constraints\`).

## When you are done

When you have asked enough questions, respond with \`{ "done": true, "gap": ... }\` and a gap assessment describing whether anything critical is still missing:

- \`gap.status = "complete"\` — all five standard concept keys are answered, plus any project-specific context relevant to this project. \`gap.missing\` MUST be an empty array.
- \`gap.status = "nice_to_have_missing"\` — all critical info is present but some helpful context is missing (e.g., target deployment environment). \`gap.missing\` lists the missing items in human-readable form.
- \`gap.status = "critical_missing"\` — at least one of the five standard concept keys (project_type, primary_users, expected_scale, auth_requirements, data_persistence) was not adequately answered, OR a project-specific concern critical to scaffolding is unknown. \`gap.missing\` lists the missing items in human-readable form.

Always include a \`gap.rationale\` (one or two sentences) explaining your assessment.

If you are not done yet, respond with \`{ "done": false, "question": <Question> }\`.

Aim for 5-10 questions total. Prefer asking a clarifying question over signaling \`critical_missing\` — only choose \`critical_missing\` when continued questioning would not help (e.g., the user has skipped the question or is clearly unable to answer).`;

const QuestionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9_]*$/, 'id must be snake_case'),
    prompt: z.string().min(1),
    type: z.enum(['input', 'select', 'multi-select', 'confirm']),
    choices: z.array(z.string().min(1)).optional(),
    rationale: z.string().min(1).optional(),
  })
  .refine(
    (q) =>
      (q.type !== 'select' && q.type !== 'multi-select') ||
      (Array.isArray(q.choices) && q.choices.length >= 2),
    { message: 'select and multi-select questions must include at least 2 choices' },
  );

const GapAssessmentSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('complete'),
    missing: z.array(z.string().min(1)).length(0),
    rationale: z.string().min(1),
  }),
  z.object({
    status: z.literal('nice_to_have_missing'),
    missing: z.array(z.string().min(1)).min(1),
    rationale: z.string().min(1),
  }),
  z.object({
    status: z.literal('critical_missing'),
    missing: z.array(z.string().min(1)).min(1),
    rationale: z.string().min(1),
  }),
]);

const NextStepResponseSchema = z.discriminatedUnion('done', [
  z.object({ done: z.literal(false), question: QuestionSchema }),
  z.object({ done: z.literal(true), gap: GapAssessmentSchema }),
]);

export function createArchitectAgent(opts: ArchitectAgentOptions): ArchitectAgent {
  if (opts.maxQuestions !== undefined && opts.maxQuestions < 1) {
    throw new SpexError(`maxQuestions must be >= 1 (got ${opts.maxQuestions})`);
  }
  const seed = opts.seed ?? DEFAULT_SEED;
  const maxQuestions = opts.maxQuestions ?? DEFAULT_MAX_QUESTIONS;

  return {
    seedQuestion: () => seed,
    async nextStep(history) {
      if (history.length >= maxQuestions) {
        // Defensive cap reached: treat as done with a "max questions hit" assessment
        // rather than make another LLM call. The LLM's own done-signal handling
        // is preferred when it fires earlier.
        return {
          type: 'done',
          gap: {
            status: 'nice_to_have_missing',
            missing: [`maxQuestions cap (${maxQuestions}) reached before architect signaled done`],
            rationale:
              'The architect reached its defensive question cap without explicitly signaling done. Accepting the current answers as-is.',
          },
        };
      }
      const response = await opts.llm.generateStructured({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: formatHistory(history),
        schema: NextStepResponseSchema,
      });
      if (response.done) {
        return { type: 'done', gap: toGapAssessment(response.gap) };
      }
      return { type: 'question', question: toQuestion(response.question) };
    },
  };
}

function toGapAssessment(parsed: z.infer<typeof GapAssessmentSchema>): GapAssessment {
  return {
    status: parsed.status,
    missing: parsed.missing,
    rationale: parsed.rationale,
  };
}

function toQuestion(parsed: z.infer<typeof QuestionSchema>): Question {
  const base: Question = {
    id: parsed.id,
    prompt: parsed.prompt,
    type: parsed.type,
  };
  const withChoices: Question =
    parsed.choices !== undefined ? { ...base, choices: parsed.choices } : base;
  return parsed.rationale !== undefined
    ? { ...withChoices, rationale: parsed.rationale }
    : withChoices;
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
  lines.push(
    'Generate the next question, or signal done with a gap assessment if you have enough information.',
  );
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
