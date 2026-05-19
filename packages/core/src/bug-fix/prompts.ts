import type {
  BugContext,
  FixProposal,
  Hypothesis,
  RootCauseAnalysis,
  TestFramework,
} from '@spex/schemas';
import type { TestingPattern } from '../context/types.js';

export const HYPOTHESIS_SYSTEM_PROMPT = `You are SPEX, a senior engineer reasoning carefully about why a bug occurs.

Your task is to produce 3-5 ranked hypotheses for the bug described in the user message.

Rules:
- Output between 3 and 5 hypotheses. No fewer, no more.
- Order them by DESCENDING confidence (highest first). IDs are h1, h2, h3, ... matching that order.
- Each hypothesis MUST cite at least one piece of SPECIFIC evidence from the bug context: a file path, a stack-frame location, a commit sha, an exact error message fragment. Generic statements ("there could be a bug") are not evidence.
- Each hypothesis MUST include a proposedDiagnostic: a concrete, executable next step to confirm or rule it out (e.g. "run with DEBUG=true and check the X log line", "open <file> and inspect <function>", "compare current behaviour to the commit before <sha>").
- Use confidence levels honestly: 'high' = strong evidence + clear mechanism, 'medium' = plausible but not certain, 'low' = consider-but-unlikely. Don't mark every hypothesis 'high'.
- descriptions are 1-2 sentences explaining the proposed root cause.
- Be specific. Do not hedge. Do not propose hypotheses that you cannot tie to the supplied evidence.`;

export interface BuildHypothesisUserPromptOptions {
  bugContext: BugContext;
}

export function buildHypothesisUserPrompt(opts: BuildHypothesisUserPromptOptions): string {
  return `${formatBugContextForPrompt(opts.bugContext)}\n\nProduce 3-5 ranked hypotheses for this bug.`;
}

export function formatBugContextForPrompt(context: BugContext): string {
  const sections: string[] = [];

  sections.push(`### Bug description\n${context.description}`);

  if (context.error) {
    const parts: string[] = [];
    if (context.error.message) parts.push(`- message: ${context.error.message}`);
    if (context.error.stack) parts.push(`- stack:\n\`\`\`\n${context.error.stack}\n\`\`\``);
    if (context.error.firstOccurrence) {
      parts.push(`- firstOccurrence: ${context.error.firstOccurrence}`);
    }
    sections.push(`### Error info\n${parts.join('\n')}`);
  }

  if (context.errorReference) {
    sections.push(
      `### Error reference\n- source: ${context.errorReference.source}\n- id: ${context.errorReference.id}`,
    );
  }

  if (context.affectedFiles.length > 0) {
    sections.push(`### Affected files\n${context.affectedFiles.map((p) => `- ${p}`).join('\n')}`);
  } else {
    sections.push('### Affected files\n(none flagged by the reporter)');
  }

  if (context.recentCommits.length > 0) {
    const commits = context.recentCommits
      .map((c) => `- ${c.sha.slice(0, 10)}  ${c.date}  ${c.message}`)
      .join('\n');
    sections.push(`### Recent commits (newest first)\n${commits}`);
  } else {
    sections.push('### Recent commits\n(no git history available)');
  }

  if (context.affectedFileContents && Object.keys(context.affectedFileContents).length > 0) {
    const blocks = Object.entries(context.affectedFileContents)
      .map(([path, content]) => `=== ${path} ===\n${content}=== end of ${path} ===`)
      .join('\n\n');
    sections.push(`### Affected file contents\n${blocks}`);
  }

  return sections.join('\n\n');
}

export const ROOT_CAUSE_SYSTEM_PROMPT = `You are SPEX, a senior engineer doing targeted root-cause analysis on ONE hypothesis.

Your task is to take the hypothesis provided in the user message and either CONFIRM it as the root cause or REFUTE it.

Rules:
- Read the supplied affected file contents carefully. Cite specific lines (single line "42" or range "42-58") from those files as evidence.
- Each evidence item: { file: <path that appears in the supplied contents>, lines: <line or range>, explanation: <why this confirms or refutes the hypothesis> }.
- Provide at least 1 evidence item.
- If you confirm the hypothesis: set confirmed=true and write a complete rootCause statement (2-4 sentences explaining the underlying mechanism).
- If you refute the hypothesis:
  - set confirmed=false
  - write rootCause as "Hypothesis <id> rejected: <why>"
  - set nextHypothesisToTest to a short string in the form "<id> — <one-line reason>" (e.g. "h2 — server-side rendering of page param"). Without this field a refuted analysis is invalid.
- Do not invent file paths or line numbers. Cite only what appears in the supplied file contents. If the contents do not contain enough information to confirm OR refute, refute it and explain what is missing.
- Be specific. Do not hedge.`;

export interface BuildRootCauseUserPromptOptions {
  bugContext: BugContext;
  hypothesis: Hypothesis;
}

export function buildRootCauseUserPrompt(opts: BuildRootCauseUserPromptOptions): string {
  return `${formatBugContextForPrompt(opts.bugContext)}\n\n${formatHypothesisForPrompt(opts.hypothesis)}\n\nAnalyse this hypothesis against the file contents above. Cite specific line ranges. Confirm or refute it and produce a RootCauseAnalysis.`;
}

function formatHypothesisForPrompt(hypothesis: Hypothesis): string {
  const evidence = hypothesis.evidence.map((line) => `  - ${line}`).join('\n');
  return `### Hypothesis under analysis
- id: ${hypothesis.id}
- confidence: ${hypothesis.confidence}
- description: ${hypothesis.description}
- previously cited evidence:
${evidence}
- proposedDiagnostic: ${hypothesis.proposedDiagnostic}`;
}

export const FIX_PROPOSAL_SYSTEM_PROMPT = `You are SPEX, a senior engineer proposing fixes for a confirmed root cause.

Your task is to take the confirmed root cause provided in the user message and propose 1-3 fix options.

Rules:
- Output between 1 and 3 options. Use 1 only when the fix is genuinely a single sensible approach (e.g. a one-line patch with no meaningful alternative). Use 2 when there is a clear minimal-vs-robust split. Use 3 only when an intermediate option adds real value.
- Each option:
  - id: o1, o2, o3 in presentation order.
  - label: short imperative phrase (e.g. "Minimal patch", "Robust refactor", "Full rewrite").
  - scope: 'minimal' (1-2 lines, single hunk), 'moderate' (single file, multiple hunks), 'extensive' (multiple files / public API changes).
  - risk: 'low' (isolated, no side effects), 'medium' (touches shared code or behavior), 'high' (changes public API, runtime semantics, or behavior far from the bug site).
  - rationale: 1-3 sentences explaining why this option is sensible and what trade-offs it makes.
  - diff: a unified diff (---/+++/@@) against the file contents supplied in the user message. The diff MUST apply cleanly to those contents.
- Two options must NOT be equivalent in scope AND risk — if you have two similar options collapse them into one.
- recommended: id of the option you would advise applying. Default to the LOWEST-risk option that actually addresses the root cause. Only recommend a higher-risk option when the lower-risk one leaves the root cause partially unfixed; explain why if so.
- recommendationRationale: 2-4 sentences explaining why you picked the recommended option over the other options.
- Do not invent file paths. Diffs must reference paths from the supplied file contents.
- Be specific. Do not hedge.`;

export interface BuildFixProposalUserPromptOptions {
  bugContext: BugContext;
  hypothesis: Hypothesis;
  rootCauseAnalysis: RootCauseAnalysis;
}

export function buildFixProposalUserPrompt(opts: BuildFixProposalUserPromptOptions): string {
  return `${formatBugContextForPrompt(opts.bugContext)}\n\n${formatHypothesisForPrompt(opts.hypothesis)}\n\n${formatRootCauseForPrompt(opts.rootCauseAnalysis)}\n\nPropose 1-3 fix options against the file contents above. Each diff must apply cleanly.`;
}

function formatRootCauseForPrompt(analysis: RootCauseAnalysis): string {
  const evidence = analysis.evidence
    .map((e) => `  - ${e.file}:${e.lines} — ${e.explanation}`)
    .join('\n');
  return `### Confirmed root cause
- statement: ${analysis.rootCause}
- supporting evidence:
${evidence}`;
}

export const REGRESSION_TEST_SYSTEM_PROMPT = `You are SPEX, a senior engineer writing a regression test that pins down a confirmed bug.

Your task is to produce ONE regression test that:
- FAILS against the current (buggy) code, demonstrating the bug.
- PASSES once the recommended fix is applied.

Rules:
- path: a relative file path inside the project that ends in ".test.{ts,tsx,js,jsx}" or ".spec.{ts,tsx,js,jsx}" so the test runner picks it up. Use the project's detected testing pattern (colocated next to the source, under tests/, or under __tests__/).
- framework: must match the framework hinted in the user message. Use that framework's idiomatic test API ('describe' / 'test' / 'it', 'expect', etc.).
- content: the FULL test file, ready to write to disk. Include all needed imports relative to the project root. Do not include code blocks or markdown — only TypeScript/JavaScript source.
- rationale: 1-3 sentences explaining how this test reproduces the bug and what it asserts post-fix.

Constraints:
- Do not invent module paths. Import only files that appear in the supplied file contents or are conventionally part of the project (e.g. the package name in package.json).
- The test must be deterministic — no time-of-day checks, no network calls, no random seeds.
- Keep the test focused: a single failing assertion is better than a sprawling integration test.
- If you reference an export that doesn't exist yet in the buggy code but will exist after the fix, that's a problem — restructure the test to assert on observable behaviour of currently-existing exports.
- Be specific. Do not produce a test that would pass on broken code.`;

export interface BuildRegressionTestUserPromptOptions {
  bugContext: BugContext;
  rootCauseAnalysis: RootCauseAnalysis;
  framework: TestFramework;
  testingPattern?: TestingPattern;
  fixProposal?: FixProposal;
}

export function buildRegressionTestUserPrompt(opts: BuildRegressionTestUserPromptOptions): string {
  const sections: string[] = [
    formatBugContextForPrompt(opts.bugContext),
    formatRootCauseForPrompt(opts.rootCauseAnalysis),
    formatTestEnvironment(opts.framework, opts.testingPattern),
  ];
  if (opts.fixProposal) {
    sections.push(formatRecommendedFixForPrompt(opts.fixProposal));
  }
  sections.push(
    'Produce one regression test that FAILS against the current code and PASSES after the recommended fix is applied.',
  );
  return sections.join('\n\n');
}

function formatTestEnvironment(
  framework: TestFramework,
  pattern: TestingPattern | undefined,
): string {
  const placement =
    pattern === 'colocated'
      ? 'Place the test alongside the source it covers (e.g. src/foo/bar.ts → src/foo/bar.test.ts).'
      : pattern === 'tests-folder'
        ? 'Place the test under a top-level tests/ directory mirroring the source path.'
        : pattern === '__tests__-folder'
          ? 'Place the test inside a __tests__/ sibling directory next to the source.'
          : 'No testing pattern detected — colocate the test next to the source it covers.';
  return `### Test environment
- framework: ${framework}
- placement convention: ${placement}`;
}

function formatRecommendedFixForPrompt(proposal: FixProposal): string {
  const recommended = proposal.options.find((o) => o.id === proposal.recommended);
  if (!recommended) {
    return '### Recommended fix\n(invalid proposal — no matching option, treat as unknown)';
  }
  return `### Recommended fix (must pass after applying)
- option: ${recommended.label} (${recommended.scope}, risk=${recommended.risk})
- rationale: ${recommended.rationale}
- diff:
${recommended.diff}`;
}
