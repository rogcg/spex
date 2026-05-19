import type {
  BugContext,
  BugErrorInfo,
  FixOption,
  FixProposal,
  Hypothesis,
  HypothesisList,
  RegressionTest,
  RootCauseAnalysis,
} from '@spex/schemas';
import { collectBugContext } from '../bug-context/collector.js';
import { buildCodebaseContext } from '../context/aggregator.js';
import { SpexError } from '../errors.js';
import type { LLMProvider } from '../llm/provider.js';
import { type ApplyFixDiffResult, applyFixDiff, revertFixDiff } from './diff-applier.js';
import { generateFixProposal } from './fix-proposal-generator.js';
import { generateHypotheses } from './hypothesis-generator.js';
import { generateRegressionTest } from './regression-test-generator.js';
import { type RegressionRunOutput, verifyRegressionTest } from './regression-test-verifier.js';
import { analyzeRootCause } from './root-cause-analyzer.js';
import { detectTestingFramework } from './testing-framework.js';

const HYPOTHESIS_ID_PATTERN = /^h[1-9][0-9]*/;

export class ExhaustedHypothesesError extends SpexError {
  readonly attempts: number;
  readonly lastAnalysis: RootCauseAnalysis;
  constructor(attempts: number, lastAnalysis: RootCauseAnalysis) {
    super(
      `Exhausted ${attempts} hypotheses without confirming a root cause. Refine the bug description or supply more affectedFiles, then re-run.`,
    );
    this.attempts = attempts;
    this.lastAnalysis = lastAnalysis;
  }
}

export class TestingFrameworkNotDetectedError extends SpexError {
  constructor(signal: string) {
    super(
      `Could not detect a test framework (vitest or jest) in package.json. Detection signal: ${signal}. Pass an explicit \`framework\` option or add a vitest/jest devDependency.`,
    );
  }
}

export interface RunFixFlowOptions {
  llm: LLMProvider;
  projectDir: string;
  description: string;
  affectedFiles?: readonly string[];
  error?: BugErrorInfo;
  /** Maximum hypothesis attempts before giving up. Defaults to 3. */
  maxHypothesisAttempts?: number;
  /**
   * If true, the flow stops after generating the regression test (and the
   * filesystem is left unchanged). Useful for previewing the proposed fix.
   */
  dryRun?: boolean;
  /** Test framework override. Defaults to detection from `package.json`. */
  framework?: 'vitest' | 'jest';
  /**
   * Test runner command override (passed verbatim to the regression-test
   * verifier). Use when the project's `vitest`/`jest` is not on PATH.
   */
  testCommand?: {
    bin: string;
    args?: readonly string[];
    appendTestPath?: boolean;
  };

  // Interactive hooks — supplied by the CLI for prompts. The MCP tool omits
  // them, in which case sensible defaults are used (h1 hypothesis, recommended
  // option, all approvals = true).
  selectHypothesis?: (list: HypothesisList) => Promise<Hypothesis>;
  approveRootCause?: (analysis: RootCauseAnalysis) => Promise<boolean>;
  selectFixOption?: (proposal: FixProposal) => Promise<FixOption>;
  approveRegressionTest?: (test: RegressionTest) => Promise<boolean>;
}

export interface RunFixFlowResult {
  dryRun: boolean;
  bugContext: BugContext;
  hypotheses: HypothesisList;
  selectedHypothesis: Hypothesis;
  hypothesisAttempts: number;
  rootCauseAnalysis: RootCauseAnalysis;
  fixProposal: FixProposal;
  selectedOption: FixOption;
  regressionTest: RegressionTest;
  /** Present when the flow ran beyond dry-run. */
  verifierResult?: {
    failedBeforeFix: boolean;
    passedAfterFix: boolean;
    beforeRun: RegressionRunOutput;
    afterRun: RegressionRunOutput;
  };
  /** Present when the fix was applied to disk. */
  appliedFix?: ApplyFixDiffResult;
  /** All project-relative paths the run created or modified (sorted, deduped). */
  affectedPaths: string[];
}

/**
 * The bug-fix pipeline as a single pure function. The CLI and the
 * MCP `spex_fix` tool both call this — the only difference is the supplied
 * interactive hooks. With no hooks, the flow auto-selects:
 *
 * - hypothesis: h1 (the LLM's highest-ranked)
 * - root cause: accepted if confirmed
 * - fix option: the recommended one
 * - regression test: accepted
 */
export async function runFixFlow(opts: RunFixFlowOptions): Promise<RunFixFlowResult> {
  const maxAttempts = opts.maxHypothesisAttempts ?? 3;
  const selectHypothesis =
    opts.selectHypothesis ??
    (async (list: HypothesisList): Promise<Hypothesis> => {
      const head = list.hypotheses[0];
      if (!head) throw new SpexError('hypothesis list is empty');
      return head;
    });
  const approveRootCause = opts.approveRootCause ?? (async () => true);
  const selectFixOption =
    opts.selectFixOption ??
    (async (proposal: FixProposal): Promise<FixOption> => {
      const recommended = proposal.options.find((o) => o.id === proposal.recommended);
      if (!recommended) throw new SpexError('proposal.recommended does not match any option id');
      return recommended;
    });
  const approveRegressionTest = opts.approveRegressionTest ?? (async () => true);

  // Phase 1: codebase context (for package info + detected patterns)
  const codebaseContext = await buildCodebaseContext({ projectDir: opts.projectDir });

  // Detect / pick framework
  const framework: 'vitest' | 'jest' = (() => {
    if (opts.framework) return opts.framework;
    const detection = detectTestingFramework(codebaseContext.packageInfo);
    if (detection.framework) return detection.framework;
    throw new TestingFrameworkNotDetectedError(detection.signal);
  })();

  // Phase 2: bug context
  const bugContext = await collectBugContext({
    projectDir: opts.projectDir,
    description: opts.description,
    ...(opts.error ? { error: opts.error } : {}),
    ...(opts.affectedFiles ? { affectedFiles: opts.affectedFiles } : {}),
  });

  // Phase 3: hypotheses
  const hypotheses = await generateHypotheses({ llm: opts.llm, bugContext });

  // Phase 4: hypothesis-to-root-cause loop (up to `maxAttempts` LLM rounds)
  const initialHypothesis = await selectHypothesis(hypotheses);
  let currentHypothesis = initialHypothesis;
  let analysis: RootCauseAnalysis | undefined;
  let attempts = 0;
  while (true) {
    attempts += 1;
    analysis = await analyzeRootCause({
      llm: opts.llm,
      bugContext,
      hypothesis: currentHypothesis,
    });
    if (analysis.confirmed) break;
    if (attempts >= maxAttempts) {
      throw new ExhaustedHypothesesError(attempts, analysis);
    }
    const next = pickNextHypothesis(hypotheses, analysis, currentHypothesis.id);
    if (!next) {
      throw new ExhaustedHypothesesError(attempts, analysis);
    }
    currentHypothesis = next;
  }
  const rootCauseAnalysis = analysis;

  // Approval gate: confirmed root cause
  const rcApproved = await approveRootCause(rootCauseAnalysis);
  if (!rcApproved) {
    throw new SpexError('Root cause rejected by caller; aborting fix flow.');
  }

  // Phase 5: fix proposal
  const fixProposal = await generateFixProposal({
    llm: opts.llm,
    bugContext,
    hypothesis: currentHypothesis,
    rootCauseAnalysis,
  });
  const selectedOption = await selectFixOption(fixProposal);

  // Phase 6: regression test
  const regressionTest = await generateRegressionTest({
    llm: opts.llm,
    bugContext,
    rootCauseAnalysis,
    framework,
    ...(codebaseContext.detectedPatterns.testingPattern !== 'unknown'
      ? { testingPattern: codebaseContext.detectedPatterns.testingPattern }
      : {}),
    fixProposal: { ...fixProposal, recommended: selectedOption.id },
  });
  const regApproved = await approveRegressionTest(regressionTest);
  if (!regApproved) {
    throw new SpexError('Regression test rejected by caller; aborting fix flow.');
  }

  if (opts.dryRun) {
    return {
      dryRun: true,
      bugContext,
      hypotheses,
      selectedHypothesis: currentHypothesis,
      hypothesisAttempts: attempts,
      rootCauseAnalysis,
      fixProposal,
      selectedOption,
      regressionTest,
      affectedPaths: collectAffectedPaths(selectedOption.diff, regressionTest.path),
    };
  }

  // Phase 7: verify fail-then-pass cycle. The verifier handles applying the
  // fix, running the test, and rolling back if anything goes wrong.
  let appliedFix: ApplyFixDiffResult | undefined;
  const verifierResult = await verifyRegressionTest({
    projectDir: opts.projectDir,
    regressionTest,
    applyFix: async () => {
      appliedFix = await applyFixDiff(opts.projectDir, selectedOption.diff);
    },
    revertFix: async () => {
      if (appliedFix) await revertFixDiff(appliedFix.snapshots);
    },
    ...(opts.testCommand ? { testCommand: opts.testCommand } : {}),
  });

  if (!appliedFix) {
    // Shouldn't happen — applyFix is always called by the verifier when it
    // reaches the "apply" phase. Guard against future refactors.
    throw new SpexError('Internal error: fix was reported applied but no snapshot was recorded.');
  }

  return {
    dryRun: false,
    bugContext,
    hypotheses,
    selectedHypothesis: currentHypothesis,
    hypothesisAttempts: attempts,
    rootCauseAnalysis,
    fixProposal,
    selectedOption,
    regressionTest,
    verifierResult: {
      failedBeforeFix: verifierResult.failedBeforeFix,
      passedAfterFix: verifierResult.passedAfterFix,
      beforeRun: verifierResult.beforeRun,
      afterRun: verifierResult.afterRun,
    },
    appliedFix,
    affectedPaths: dedupe([regressionTest.path, ...appliedFix.affectedPaths]).sort(),
  };
}

function pickNextHypothesis(
  list: HypothesisList,
  analysis: RootCauseAnalysis,
  alreadyTriedId: string,
): Hypothesis | null {
  if (!analysis.nextHypothesisToTest) return null;
  const match = HYPOTHESIS_ID_PATTERN.exec(analysis.nextHypothesisToTest);
  const nextId = match?.[0];
  if (!nextId || nextId === alreadyTriedId) return null;
  return list.hypotheses.find((h) => h.id === nextId) ?? null;
}

function collectAffectedPaths(diff: string, testPath: string): string[] {
  const paths = new Set<string>();
  paths.add(testPath);
  for (const line of diff.split('\n')) {
    const m = /^\+\+\+ (?:b\/)?(.+)$/.exec(line) ?? /^--- (?:a\/)?(.+)$/.exec(line);
    if (m) {
      const p = m[1]?.trim();
      if (p && p !== '/dev/null') paths.add(p);
    }
  }
  return [...paths].sort();
}

function dedupe(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}
