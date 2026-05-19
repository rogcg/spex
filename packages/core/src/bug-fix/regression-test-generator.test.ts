import type { BugContext, FixProposal, RegressionTest, RootCauseAnalysis } from '@spex/schemas';
import { RegressionTestSchema } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/provider.js';
import { REGRESSION_TEST_SYSTEM_PROMPT, buildRegressionTestUserPrompt } from './prompts.js';
import {
  UnconfirmedRootCauseForRegressionTestError,
  generateRegressionTest,
} from './regression-test-generator.js';

const bugContext: BugContext = {
  description: 'Pagination resets on filter change.',
  affectedFiles: ['src/app/users/page.tsx'],
  recentCommits: [],
  affectedFileContents: {
    'src/app/users/page.tsx':
      'export default function UsersPage({ filter }) {\n  return <Users key={filter} />;\n}\n',
  },
};

const confirmedAnalysis: RootCauseAnalysis = {
  confirmed: true,
  rootCause:
    'UsersPage passes filter as React key of <Users />, forcing the subtree to remount and discard pagination state.',
  evidence: [
    {
      file: 'src/app/users/page.tsx',
      lines: '2',
      explanation: '`<Users key={filter} />` — key change remounts the subtree.',
    },
  ],
};

const refutedAnalysis: RootCauseAnalysis = {
  confirmed: false,
  rootCause: 'Hypothesis h1 rejected: pagination uses URL state, not local state.',
  evidence: [
    {
      file: 'src/app/users/page.tsx',
      lines: '2',
      explanation: 'No useState in the subtree.',
    },
  ],
  nextHypothesisToTest: 'h2 — SSR drops page param',
};

const sample: RegressionTest = {
  path: 'src/app/users/page.test.tsx',
  content: 'test("pagination survives filter change", () => {});\n',
  framework: 'vitest',
  rationale:
    'Reproduces the bug: filter change should NOT reset the paginated cursor. The test pins that behaviour.',
};

const fixProposal: FixProposal = {
  options: [
    {
      id: 'o1',
      label: 'Minimal patch',
      scope: 'minimal',
      risk: 'low',
      rationale: 'Drop the `key={filter}` so the subtree no longer remounts on filter change.',
      diff: '--- a/src/app/users/page.tsx\n+++ b/src/app/users/page.tsx\n@@\n-<Users key={filter} />\n+<Users />\n',
    },
  ],
  recommended: 'o1',
  recommendationRationale: 'Single sensible approach: drop the key prop.',
};

describe('REGRESSION_TEST_SYSTEM_PROMPT', () => {
  it('codifies the fail-then-pass requirement', () => {
    expect(REGRESSION_TEST_SYSTEM_PROMPT).toContain('FAILS against the current');
    expect(REGRESSION_TEST_SYSTEM_PROMPT).toContain('PASSES once the recommended fix is applied');
  });

  it('requires a path ending in .test or .spec', () => {
    expect(REGRESSION_TEST_SYSTEM_PROMPT).toContain('.test.');
    expect(REGRESSION_TEST_SYSTEM_PROMPT).toContain('.spec.');
  });

  it('demands deterministic tests', () => {
    expect(REGRESSION_TEST_SYSTEM_PROMPT).toContain('deterministic');
  });
});

describe('buildRegressionTestUserPrompt', () => {
  it('embeds the bug context, confirmed root cause, framework, and pattern hint', () => {
    const prompt = buildRegressionTestUserPrompt({
      bugContext,
      rootCauseAnalysis: confirmedAnalysis,
      framework: 'vitest',
      testingPattern: 'colocated',
    });
    expect(prompt).toContain('Pagination resets on filter change');
    expect(prompt).toContain('UsersPage passes filter as React key');
    expect(prompt).toContain('framework: vitest');
    // The 'colocated' testingPattern hint translates to placement guidance
    expect(prompt).toContain('alongside the source');
    expect(prompt).toContain('Produce one regression test');
  });

  it('embeds the recommended fix when supplied so the LLM can produce a will-pass test', () => {
    const prompt = buildRegressionTestUserPrompt({
      bugContext,
      rootCauseAnalysis: confirmedAnalysis,
      framework: 'vitest',
      fixProposal,
    });
    expect(prompt).toContain('### Recommended fix');
    expect(prompt).toContain('Minimal patch');
    expect(prompt).toContain('Drop the `key={filter}`');
  });
});

describe('generateRegressionTest', () => {
  it('forwards the system prompt and RegressionTestSchema to the LLM', async () => {
    const generate = vi.fn().mockResolvedValue(sample);
    const llm: LLMProvider = { generateStructured: generate };

    const result = await generateRegressionTest({
      llm,
      bugContext,
      rootCauseAnalysis: confirmedAnalysis,
      framework: 'vitest',
      testingPattern: 'colocated',
    });

    expect(result).toEqual(sample);
    const call = generate.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.systemPrompt).toBe(REGRESSION_TEST_SYSTEM_PROMPT);
    expect(call.schema).toBe(RegressionTestSchema);
  });

  it('refuses to run when the root cause is not confirmed', async () => {
    const generate = vi.fn();
    const llm: LLMProvider = { generateStructured: generate };

    await expect(
      generateRegressionTest({
        llm,
        bugContext,
        rootCauseAnalysis: refutedAnalysis,
        framework: 'vitest',
      }),
    ).rejects.toBeInstanceOf(UnconfirmedRootCauseForRegressionTestError);
    expect(generate).not.toHaveBeenCalled();
  });

  it('propagates LLM errors', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockRejectedValue(new Error('llm down')),
    };
    await expect(
      generateRegressionTest({
        llm,
        bugContext,
        rootCauseAnalysis: confirmedAnalysis,
        framework: 'vitest',
      }),
    ).rejects.toThrow('llm down');
  });
});
