import { confirm, input, select } from '@inquirer/prompts';
import { type DiscoveryAnswers, type LLMProvider, recommendStack } from '@spex/core';
import type { StackDecision, StackRecommendation } from '@spex/schemas';
import { STRINGS } from '../strings.js';

export type StackSelectionEntryState =
  | { kind: 'no-preference' }
  | { kind: 'partial-constraints'; constraints: string }
  | { kind: 'explicit-choice'; choice: string }
  | { kind: 'brainstorm' };

export interface StackSelectionPrompts {
  pickRecommendation(
    recommendations: readonly StackRecommendation[],
  ): Promise<{ rank: number } | { brainstorm: true }>;
  acknowledgeValidation(warnings: readonly string[]): Promise<boolean>;
  brainstormRound(history: readonly BrainstormTurn[]): Promise<BrainstormUserReply>;
}

export interface BrainstormTurn {
  proposal: StackRecommendation;
  userFeedback: string;
}

export type BrainstormUserReply = { kind: 'accept' } | { kind: 'refine'; feedback: string };

export interface StackSelectionLogger {
  log(line: string): void;
}

export interface RunStackSelectionOptions {
  llm: LLMProvider;
  projectName: string;
  answers: DiscoveryAnswers;
  entry: StackSelectionEntryState;
  prompts?: StackSelectionPrompts;
  logger?: StackSelectionLogger;
  maxBrainstormRounds?: number;
}

const DEFAULT_MAX_BRAINSTORM_ROUNDS = 5;

export async function runStackSelection(opts: RunStackSelectionOptions): Promise<StackDecision> {
  const prompts = opts.prompts ?? defaultPrompts();
  const logger = opts.logger ?? { log: (line: string) => console.log(line) };

  switch (opts.entry.kind) {
    case 'no-preference':
      return runNoPreference(opts, prompts, logger);
    case 'partial-constraints':
      return runPartialConstraints(opts, prompts, logger, opts.entry.constraints);
    case 'explicit-choice':
      return runExplicitChoice(opts, prompts, logger, opts.entry.choice);
    case 'brainstorm':
      return runBrainstorm(opts, prompts, logger);
  }
}

async function runNoPreference(
  opts: RunStackSelectionOptions,
  prompts: StackSelectionPrompts,
  logger: StackSelectionLogger,
): Promise<StackDecision> {
  logger.log(STRINGS.stackSelection.recommending);
  const recs = await recommendStack({
    llm: opts.llm,
    projectName: opts.projectName,
    answers: opts.answers,
  });
  logger.log(STRINGS.stackSelection.recommendationsHeader(recs.recommendations.length));
  for (const rec of recs.recommendations) {
    logger.log(formatRecommendation(rec));
  }
  if (recs.unmappedRequirements.length) {
    logger.log(STRINGS.stackSelection.unmappedHeader);
    for (const item of recs.unmappedRequirements) {
      logger.log(`  - ${item}`);
    }
  }

  const choice = await prompts.pickRecommendation(recs.recommendations);
  if ('brainstorm' in choice) {
    return runBrainstorm(opts, prompts, logger);
  }
  const picked = recs.recommendations.find((r) => r.rank === choice.rank);
  if (!picked) {
    throw new Error(`Selected rank ${choice.rank} not found in recommendations.`);
  }
  return {
    label: picked.label,
    source: 'recommended',
    components: picked.components,
    rationale: defaultRationale(picked),
    tradeoffs: picked.tradeoffs,
    validationWarnings: [],
  };
}

async function runPartialConstraints(
  opts: RunStackSelectionOptions,
  prompts: StackSelectionPrompts,
  logger: StackSelectionLogger,
  constraints: string,
): Promise<StackDecision> {
  logger.log(STRINGS.stackSelection.respectingConstraints(constraints));
  const recs = await recommendStack({
    llm: opts.llm,
    projectName: opts.projectName,
    answers: opts.answers,
    explicitConstraints: constraints,
  });
  logger.log(STRINGS.stackSelection.recommendationsHeader(recs.recommendations.length));
  for (const rec of recs.recommendations) {
    logger.log(formatRecommendation(rec));
  }

  const choice = await prompts.pickRecommendation(recs.recommendations);
  if ('brainstorm' in choice) {
    return runBrainstorm(opts, prompts, logger);
  }
  const picked = recs.recommendations.find((r) => r.rank === choice.rank);
  if (!picked) {
    throw new Error(`Selected rank ${choice.rank} not found in recommendations.`);
  }
  return {
    label: picked.label,
    source: 'recommended',
    components: picked.components,
    rationale: `${defaultRationale(picked)} (honors constraints: ${constraints})`,
    tradeoffs: picked.tradeoffs,
    validationWarnings: [],
  };
}

async function runExplicitChoice(
  opts: RunStackSelectionOptions,
  prompts: StackSelectionPrompts,
  logger: StackSelectionLogger,
  choice: string,
): Promise<StackDecision> {
  logger.log(STRINGS.stackSelection.validatingExplicitChoice(choice));
  const recs = await recommendStack({
    llm: opts.llm,
    projectName: opts.projectName,
    answers: opts.answers,
    explicitConstraints: `User has explicitly chosen this stack: ${choice}. Validate it against the application profile and report any mismatches via the requirementsUnaddressed field of the primary recommendation. Use exactly this label/components in the primary recommendation.`,
  });
  const primary = recs.recommendations[0];
  if (!primary) {
    throw new Error('Recommendation engine returned no recommendations to validate the choice.');
  }
  const warnings = [...primary.requirementsUnaddressed, ...recs.unmappedRequirements];
  if (warnings.length) {
    logger.log(STRINGS.stackSelection.validationWarningsHeader);
    for (const w of warnings) logger.log(`  - ${w}`);
    const proceed = await prompts.acknowledgeValidation(warnings);
    if (!proceed) {
      throw new StackSelectionCancelled('User rejected stack after validation warnings.');
    }
    logger.log(STRINGS.stackSelection.userOverrodeWarnings);
  }
  return {
    label: primary.label,
    source: 'user',
    components: primary.components,
    rationale: `User-chosen stack: ${choice}. ${defaultRationale(primary)}`,
    tradeoffs: primary.tradeoffs,
    validationWarnings: warnings,
  };
}

async function runBrainstorm(
  opts: RunStackSelectionOptions,
  prompts: StackSelectionPrompts,
  logger: StackSelectionLogger,
): Promise<StackDecision> {
  const max = opts.maxBrainstormRounds ?? DEFAULT_MAX_BRAINSTORM_ROUNDS;
  const history: BrainstormTurn[] = [];

  logger.log(STRINGS.stackSelection.brainstormStart);

  for (let round = 0; round < max; round++) {
    const constraints = formatBrainstormHistory(history);
    const recs = await recommendStack({
      llm: opts.llm,
      projectName: opts.projectName,
      answers: opts.answers,
      ...(constraints ? { explicitConstraints: constraints } : {}),
    });
    const proposal = recs.recommendations[0];
    if (!proposal) {
      throw new Error('Recommendation engine returned no recommendations during brainstorm.');
    }
    logger.log(STRINGS.stackSelection.brainstormRoundHeader(round + 1));
    logger.log(formatRecommendation(proposal));

    const reply = await prompts.brainstormRound(history);
    if (reply.kind === 'accept') {
      return {
        label: proposal.label,
        source: 'brainstormed',
        components: proposal.components,
        rationale: `Converged during brainstorm round ${round + 1}. ${defaultRationale(proposal)}`,
        tradeoffs: proposal.tradeoffs,
        validationWarnings: [],
      };
    }
    history.push({ proposal, userFeedback: reply.feedback });
  }
  throw new StackSelectionCancelled(
    `Brainstorm did not converge after ${max} rounds. Re-run with --stack=<label> or accept a recommendation.`,
  );
}

function formatBrainstormHistory(history: readonly BrainstormTurn[]): string | undefined {
  if (history.length === 0) return undefined;
  const lines: string[] = [
    'This is a collaborative brainstorm. Earlier proposals + user feedback so far:',
  ];
  for (const turn of history) {
    lines.push(`- proposed: ${turn.proposal.label}`);
    lines.push(`  user feedback: ${turn.userFeedback}`);
  }
  lines.push(
    'Refine the recommendation in light of the feedback above. Do not repeat a rejected proposal verbatim.',
  );
  return lines.join('\n');
}

function formatRecommendation(rec: StackRecommendation): string {
  const components = rec.components
    .map((c) => `    - ${c.role}: ${c.choice} — ${c.rationale}`)
    .join('\n');
  const tradeoffs = rec.tradeoffs.length
    ? rec.tradeoffs.map((t) => `    - ${t}`).join('\n')
    : '    (none)';
  return `  [${rec.rank}] ${rec.label}  (confidence: ${rec.confidence})\n  components:\n${components}\n  tradeoffs:\n${tradeoffs}`;
}

function defaultRationale(rec: StackRecommendation): string {
  return `Selected ${rec.label} — confidence ${rec.confidence}. ${rec.requirementsCovered.length ? `Covers: ${rec.requirementsCovered.join(', ')}.` : ''}`.trim();
}

export class StackSelectionCancelled extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StackSelectionCancelled';
  }
}

function defaultPrompts(): StackSelectionPrompts {
  return {
    async pickRecommendation(recommendations) {
      const choices = recommendations.map((r) => ({
        name: `[${r.rank}] ${r.label} (confidence: ${r.confidence})`,
        value: { rank: r.rank } as { rank: number },
      }));
      const value = await select<{ rank: number } | { brainstorm: true }>({
        message: STRINGS.stackSelection.pickPrompt,
        choices: [
          ...choices,
          { name: STRINGS.stackSelection.brainstormChoice, value: { brainstorm: true } },
        ],
      });
      return value;
    },
    async acknowledgeValidation(warnings) {
      return confirm({
        message: STRINGS.stackSelection.confirmOverride(warnings.length),
        default: false,
      });
    },
    async brainstormRound() {
      const action = await select<'accept' | 'refine'>({
        message: STRINGS.stackSelection.brainstormReply,
        choices: [
          { name: STRINGS.stackSelection.brainstormAccept, value: 'accept' },
          { name: STRINGS.stackSelection.brainstormRefine, value: 'refine' },
        ],
      });
      if (action === 'accept') return { kind: 'accept' };
      const feedback = await input({
        message: STRINGS.stackSelection.brainstormFeedbackPrompt,
        validate: (raw) => raw.trim().length > 0 || 'Provide feedback to refine the proposal.',
      });
      return { kind: 'refine', feedback: feedback.trim() };
    },
  };
}
