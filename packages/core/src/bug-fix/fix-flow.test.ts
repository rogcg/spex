import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FixProposal, HypothesisList, RegressionTest, RootCauseAnalysis } from '@spex/schemas';
import {
  BugContextSchema,
  FixProposalSchema,
  HypothesisListSchema,
  RegressionTestSchema,
  RootCauseAnalysisSchema,
} from '@spex/schemas';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/provider.js';
import { ExhaustedHypothesesError, runFixFlow } from './fix-flow.js';

let projectDir: string;

async function writeIn(rel: string, content: string): Promise<void> {
  const path = join(projectDir, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

// A minimal Next.js-ish project with a buggy x.txt and a known fix path.
async function scaffoldBuggyProject(): Promise<void> {
  await writeIn(
    'package.json',
    JSON.stringify({
      name: 'demo',
      version: '0.0.0',
      dependencies: { next: '^15.0.0', react: '^19.0.0' },
      devDependencies: { typescript: '^5.0.0', vitest: '^2.0.0' },
    }),
  );
  await writeIn('src/x.txt', 'BUG\n');
  await writeIn('.gitignore', 'node_modules\n');
  await execa('git', ['init', '--initial-branch=main'], { cwd: projectDir });
  await execa('git', ['config', 'user.email', 'spex-test@example.com'], { cwd: projectDir });
  await execa('git', ['config', 'user.name', 'SPEX Test'], { cwd: projectDir });
  await execa('git', ['config', 'commit.gpgSign', 'false'], { cwd: projectDir });
  await execa('git', ['add', '.'], { cwd: projectDir });
  await execa('git', ['commit', '-m', 'initial'], { cwd: projectDir });
}

const FIX_DIFF = `--- a/src/x.txt
+++ b/src/x.txt
@@ -1 +1 @@
-BUG
+OK
`;

const hypothesisList: HypothesisList = HypothesisListSchema.parse({
  hypotheses: [
    {
      id: 'h1',
      description: 'The marker file src/x.txt contains a BUG token that should not be present.',
      confidence: 'high',
      evidence: ['src/x.txt contains the string "BUG"'],
      proposedDiagnostic: 'Read src/x.txt and confirm the BUG marker is present at line 1.',
    },
    {
      id: 'h2',
      description: 'A build-time setting injects BUG into output files when NODE_ENV is unset.',
      confidence: 'medium',
      evidence: ['no relevant config detected — placeholder hypothesis'],
      proposedDiagnostic: 'Search the build pipeline for any string-replace pass on BUG.',
    },
    {
      id: 'h3',
      description: 'Git history may have added BUG through a recent commit, not the source.',
      confidence: 'low',
      evidence: ['no committed change of src/x.txt visible — purely speculative'],
      proposedDiagnostic: 'Run `git log -- src/x.txt` to check recent history.',
    },
  ],
});

const rootCause: RootCauseAnalysis = RootCauseAnalysisSchema.parse({
  confirmed: true,
  rootCause:
    'src/x.txt contains a literal BUG marker. The downstream test reads this file and fails when BUG is present, so the file content itself is the root cause.',
  evidence: [
    {
      file: 'src/x.txt',
      lines: '1',
      explanation: 'Line 1 contains the string "BUG", which the test runner rejects.',
    },
  ],
});

const refutedRootCause: RootCauseAnalysis = RootCauseAnalysisSchema.parse({
  confirmed: false,
  rootCause: 'Hypothesis h1 rejected for testing purposes.',
  evidence: [
    {
      file: 'src/x.txt',
      lines: '1',
      explanation: 'Stub refutation evidence.',
    },
  ],
  nextHypothesisToTest: 'h2 — build-time injection (also wrong but exhausts h2)',
});

const fixProposal: FixProposal = FixProposalSchema.parse({
  options: [
    {
      id: 'o1',
      label: 'Replace BUG with OK',
      scope: 'minimal',
      risk: 'low',
      rationale: 'The single-line change removes the BUG marker that the test rejects.',
      diff: FIX_DIFF,
    },
  ],
  recommended: 'o1',
  recommendationRationale:
    'Single sensible approach: replace the literal BUG marker with OK so the test passes.',
});

const regressionTest: RegressionTest = RegressionTestSchema.parse({
  path: 'src/x.regression.test.ts',
  content: '// regression test marker — the test runner reads src/x.txt directly\n',
  framework: 'vitest',
  rationale: 'Pins the assertion that src/x.txt must not contain BUG; runner exits 1 when it does.',
});

function makeStubLlm(): LLMProvider {
  const fn = vi.fn();
  fn.mockResolvedValueOnce(hypothesisList);
  fn.mockResolvedValueOnce(rootCause);
  fn.mockResolvedValueOnce(fixProposal);
  fn.mockResolvedValueOnce(regressionTest);
  return { generateStructured: fn };
}

// The same stub `node -e` runner used by the regression-test verifier tests.
const STUB_RUNNER_SCRIPT =
  "const fs=require('node:fs');const c=fs.readFileSync('src/x.txt','utf8');process.exit(c.includes('BUG')?1:0)";

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'spex-fix-flow-'));
  await scaffoldBuggyProject();
});
afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('runFixFlow', () => {
  it('walks the full pipeline, verifies fail-then-pass, and leaves the fix on disk', async () => {
    const llm = makeStubLlm();

    const result = await runFixFlow({
      llm,
      projectDir,
      description: 'src/x.txt should not contain BUG',
      affectedFiles: ['src/x.txt'],
      testCommand: {
        bin: 'node',
        args: ['-e', STUB_RUNNER_SCRIPT],
        appendTestPath: false,
      },
    });

    expect(result.dryRun).toBe(false);
    expect(result.selectedHypothesis.id).toBe('h1');
    expect(result.hypothesisAttempts).toBe(1);
    expect(result.rootCauseAnalysis.confirmed).toBe(true);
    expect(result.selectedOption.id).toBe('o1');
    expect(result.verifierResult?.failedBeforeFix).toBe(true);
    expect(result.verifierResult?.passedAfterFix).toBe(true);
    expect(result.affectedPaths).toEqual(['src/x.regression.test.ts', 'src/x.txt']);
    // Fix is on disk
    expect(await readFile(join(projectDir, 'src/x.txt'), 'utf8')).toBe('OK\n');
    // BugContext passed through the schema
    expect(BugContextSchema.safeParse(result.bugContext).success).toBe(true);
  });

  it('returns dry-run output without modifying the filesystem', async () => {
    const llm = makeStubLlm();

    const before = await readFile(join(projectDir, 'src/x.txt'), 'utf8');
    const result = await runFixFlow({
      llm,
      projectDir,
      description: 'src/x.txt should not contain BUG',
      affectedFiles: ['src/x.txt'],
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.verifierResult).toBeUndefined();
    expect(result.appliedFix).toBeUndefined();
    expect(await readFile(join(projectDir, 'src/x.txt'), 'utf8')).toBe(before);
  });

  it('loops through hypotheses when the first is refuted and the second is confirmed', async () => {
    // 1st LLM call: hypotheses; 2nd: refuted h1; 3rd: confirmed h2; then proposal + test
    const fn = vi.fn();
    fn.mockResolvedValueOnce(hypothesisList);
    fn.mockResolvedValueOnce(refutedRootCause);
    fn.mockResolvedValueOnce(rootCause);
    fn.mockResolvedValueOnce(fixProposal);
    fn.mockResolvedValueOnce(regressionTest);
    const llm: LLMProvider = { generateStructured: fn };

    const result = await runFixFlow({
      llm,
      projectDir,
      description: 'src/x.txt should not contain BUG',
      affectedFiles: ['src/x.txt'],
      testCommand: {
        bin: 'node',
        args: ['-e', STUB_RUNNER_SCRIPT],
        appendTestPath: false,
      },
    });
    expect(result.selectedHypothesis.id).toBe('h2');
    expect(result.hypothesisAttempts).toBe(2);
  });

  it('throws ExhaustedHypothesesError after the max attempts', async () => {
    // Every analysis refutes — never confirms.
    const fn = vi.fn();
    fn.mockResolvedValueOnce(hypothesisList);
    fn.mockResolvedValueOnce(refutedRootCause);
    fn.mockResolvedValueOnce({
      ...refutedRootCause,
      rootCause: 'h2 rejected too.',
      nextHypothesisToTest: 'h3 — also wrong',
    });
    fn.mockResolvedValueOnce({
      ...refutedRootCause,
      rootCause: 'h3 rejected too.',
      nextHypothesisToTest: 'h1 — looping back (but max reached)',
    });
    const llm: LLMProvider = { generateStructured: fn };

    await expect(
      runFixFlow({
        llm,
        projectDir,
        description: 'something is wrong',
        affectedFiles: ['src/x.txt'],
        maxHypothesisAttempts: 3,
      }),
    ).rejects.toBeInstanceOf(ExhaustedHypothesesError);
  });
});
