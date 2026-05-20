import {
  type Decision,
  DecisionListSchema,
  DecisionSchema,
  type StackDecision,
} from '@spex/schemas';
import { z } from 'zod';
import type { DiscoveryAnswers } from '../discovery/questions.js';
import type { LLMProvider } from '../llm/provider.js';
import {
  DECISION_ALTERNATIVES_SYSTEM_PROMPT,
  DECISION_DEBATE_SYSTEM_PROMPT,
  DECISION_REVISION_SYSTEM_PROMPT,
  PROPOSAL_DECISIONS_SYSTEM_PROMPT,
  buildDecisionAlternativesUserPrompt,
  buildDecisionDebateUserPrompt,
  buildDecisionRevisionUserPrompt,
  buildProposalDecisionsUserPrompt,
} from './prompts.js';

export interface GenerateProposalDecisionsOptions {
  llm: LLMProvider;
  projectName: string;
  answers: DiscoveryAnswers;
  decision: StackDecision;
}

export async function generateProposalDecisions(
  opts: GenerateProposalDecisionsOptions,
): Promise<Decision[]> {
  const result = await opts.llm.generateStructured({
    systemPrompt: PROPOSAL_DECISIONS_SYSTEM_PROMPT,
    userPrompt: buildProposalDecisionsUserPrompt({
      projectName: opts.projectName,
      answers: opts.answers,
      decision: opts.decision,
    }),
    schema: DecisionListSchema,
  });
  return normalizeOrders(result.decisions);
}

export interface ReviseDecisionOptions {
  llm: LLMProvider;
  decision: Decision;
  feedback: string;
}

export async function reviseDecision(opts: ReviseDecisionOptions): Promise<Decision> {
  const revised = await opts.llm.generateStructured({
    systemPrompt: DECISION_REVISION_SYSTEM_PROMPT,
    userPrompt: buildDecisionRevisionUserPrompt({
      decision: opts.decision,
      feedback: opts.feedback,
    }),
    schema: DecisionSchema,
  });
  return {
    ...revised,
    id: opts.decision.id,
    order: opts.decision.order,
    category: opts.decision.category,
    question: opts.decision.question,
    techSpecPath: opts.decision.techSpecPath,
    status: 'modified',
    userNote: opts.feedback,
  };
}

export interface ExploreAlternativesOptions {
  llm: LLMProvider;
  decision: Decision;
}

const AlternativesEnvelopeSchema = z.object({
  alternatives: z
    .array(
      z.object({
        label: z.string().min(1),
        tradeoffs: z.string().min(1),
      }),
    )
    .min(2)
    .max(3),
});

export async function exploreDecisionAlternatives(
  opts: ExploreAlternativesOptions,
): Promise<Decision> {
  const { alternatives } = await opts.llm.generateStructured({
    systemPrompt: DECISION_ALTERNATIVES_SYSTEM_PROMPT,
    userPrompt: buildDecisionAlternativesUserPrompt({ decision: opts.decision }),
    schema: AlternativesEnvelopeSchema,
  });
  return { ...opts.decision, alternatives };
}

export interface DebateDecisionOptions {
  llm: LLMProvider;
  decision: Decision;
  concern: string;
}

const DebateEnvelopeSchema = z.object({
  response: z.string().min(1),
});

export async function debateDecision(opts: DebateDecisionOptions): Promise<string> {
  const { response } = await opts.llm.generateStructured({
    systemPrompt: DECISION_DEBATE_SYSTEM_PROMPT,
    userPrompt: buildDecisionDebateUserPrompt({
      decision: opts.decision,
      concern: opts.concern,
    }),
    schema: DebateEnvelopeSchema,
  });
  return response;
}

function normalizeOrders(decisions: readonly Decision[]): Decision[] {
  const sorted = [...decisions].sort((a, b) => a.order - b.order);
  return sorted.map((d, idx) => ({ ...d, order: idx + 1 }));
}
