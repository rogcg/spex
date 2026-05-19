import {
  type BugContext,
  type FixProposal,
  FixProposalSchema,
  type Hypothesis,
  type RootCauseAnalysis,
} from '@spex/schemas';
import { SpexError } from '../errors.js';
import type { LLMProvider } from '../llm/provider.js';
import { FIX_PROPOSAL_SYSTEM_PROMPT, buildFixProposalUserPrompt } from './prompts.js';

export class UnconfirmedRootCauseError extends SpexError {
  constructor() {
    super(
      'Cannot generate a fix proposal from an unconfirmed root cause. Use the suggested nextHypothesisToTest to run another analysis first.',
    );
  }
}

export interface GenerateFixProposalOptions {
  llm: LLMProvider;
  bugContext: BugContext;
  hypothesis: Hypothesis;
  rootCauseAnalysis: RootCauseAnalysis;
}

export async function generateFixProposal(opts: GenerateFixProposalOptions): Promise<FixProposal> {
  if (!opts.rootCauseAnalysis.confirmed) {
    throw new UnconfirmedRootCauseError();
  }
  return opts.llm.generateStructured({
    systemPrompt: FIX_PROPOSAL_SYSTEM_PROMPT,
    userPrompt: buildFixProposalUserPrompt({
      bugContext: opts.bugContext,
      hypothesis: opts.hypothesis,
      rootCauseAnalysis: opts.rootCauseAnalysis,
    }),
    schema: FixProposalSchema,
  });
}
