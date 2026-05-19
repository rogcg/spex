import {
  type BugContext,
  type FixProposal,
  type RegressionTest,
  RegressionTestSchema,
  type RootCauseAnalysis,
  type TestFramework,
} from '@spex/schemas';
import type { TestingPattern } from '../context/types.js';
import { SpexError } from '../errors.js';
import type { LLMProvider } from '../llm/provider.js';
import { REGRESSION_TEST_SYSTEM_PROMPT, buildRegressionTestUserPrompt } from './prompts.js';

export class UnconfirmedRootCauseForRegressionTestError extends SpexError {
  constructor() {
    super(
      'Cannot generate a regression test for an unconfirmed root cause. Refine the analysis first.',
    );
  }
}

export interface GenerateRegressionTestOptions {
  llm: LLMProvider;
  bugContext: BugContext;
  rootCauseAnalysis: RootCauseAnalysis;
  framework: TestFramework;
  testingPattern?: TestingPattern;
  /**
   * The recommended fix. When supplied, the LLM is shown the recommended diff
   * so it can write a test that's guaranteed to PASS after that specific fix.
   * When omitted, the test pins the observable bug from the root cause alone.
   */
  fixProposal?: FixProposal;
}

export async function generateRegressionTest(
  opts: GenerateRegressionTestOptions,
): Promise<RegressionTest> {
  if (!opts.rootCauseAnalysis.confirmed) {
    throw new UnconfirmedRootCauseForRegressionTestError();
  }
  return opts.llm.generateStructured({
    systemPrompt: REGRESSION_TEST_SYSTEM_PROMPT,
    userPrompt: buildRegressionTestUserPrompt({
      bugContext: opts.bugContext,
      rootCauseAnalysis: opts.rootCauseAnalysis,
      framework: opts.framework,
      ...(opts.testingPattern !== undefined ? { testingPattern: opts.testingPattern } : {}),
      ...(opts.fixProposal !== undefined ? { fixProposal: opts.fixProposal } : {}),
    }),
    schema: RegressionTestSchema,
  });
}
