import type { BugContext, FixProposal, Hypothesis, RootCauseAnalysis } from '@spex/schemas';
import { FixProposalSchema } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/provider.js';
import { UnconfirmedRootCauseError, generateFixProposal } from './fix-proposal-generator.js';
import { FIX_PROPOSAL_SYSTEM_PROMPT, buildFixProposalUserPrompt } from './prompts.js';

const bugContext: BugContext = {
  description: 'Pagination resets on filter change.',
  affectedFiles: ['src/app/users/page.tsx'],
  recentCommits: [],
  affectedFileContents: {
    'src/app/users/page.tsx':
      'export default function UsersPage({ filter }) {\n  return <Users key={filter} />;\n}\n',
  },
};

const hypothesis: Hypothesis = {
  id: 'h1',
  description: 'Filter change passes a new key to <Users />, forcing it to remount.',
  confidence: 'high',
  evidence: ['<Users key={filter} /> in UsersPage'],
  proposedDiagnostic: 'Inspect <Users /> usage in UsersPage for a key tied to filter.',
};

const confirmedAnalysis: RootCauseAnalysis = {
  confirmed: true,
  rootCause:
    'UsersPage passes filter as React key of <Users />. Each filter change remounts the subtree, dropping local pagination state.',
  evidence: [
    {
      file: 'src/app/users/page.tsx',
      lines: '2',
      explanation: '`<Users key={filter} />` — React remounts when key changes.',
    },
  ],
};

const refutedAnalysis: RootCauseAnalysis = {
  confirmed: false,
  rootCause: 'Hypothesis h1 rejected: Pagination uses URL state, not local state.',
  evidence: [
    {
      file: 'src/app/users/page.tsx',
      lines: '2',
      explanation: 'No useState in the subtree.',
    },
  ],
  nextHypothesisToTest: 'h2 — server-side rendering loses page param',
};

const sampleProposal: FixProposal = {
  options: [
    {
      id: 'o1',
      label: 'Minimal patch',
      scope: 'minimal',
      risk: 'low',
      rationale:
        'Drop the `key={filter}` prop. Pagination state survives because the subtree no longer remounts.',
      diff: `--- a/src/app/users/page.tsx
+++ b/src/app/users/page.tsx
@@ -1,3 +1,3 @@
 export default function UsersPage({ filter }) {
-  return <Users key={filter} />;
+  return <Users />;
 }
`,
    },
    {
      id: 'o2',
      label: 'Robust refactor',
      scope: 'moderate',
      risk: 'medium',
      rationale:
        'Lift pagination state into the URL so it survives any future remount of the subtree.',
      diff: `--- a/src/app/users/page.tsx
+++ b/src/app/users/page.tsx
@@ -1,3 +1,5 @@
 export default function UsersPage({ filter }) {
+  // pagination now lives in URL state
   return <Users />;
 }
`,
    },
  ],
  recommended: 'o1',
  recommendationRationale:
    'Minimal patch is enough; lifting state to the URL is broader work that should be a separate change.',
};

describe('FIX_PROPOSAL_SYSTEM_PROMPT', () => {
  it('codifies the 1-3 option range and same-shape collapse rule', () => {
    expect(FIX_PROPOSAL_SYSTEM_PROMPT).toContain('between 1 and 3 options');
    expect(FIX_PROPOSAL_SYSTEM_PROMPT).toContain('equivalent in scope AND risk');
  });

  it('prefers the lowest-risk option by default', () => {
    expect(FIX_PROPOSAL_SYSTEM_PROMPT).toContain('LOWEST-risk option');
  });

  it('requires diffs to apply cleanly to supplied contents', () => {
    expect(FIX_PROPOSAL_SYSTEM_PROMPT).toContain('apply cleanly');
    expect(FIX_PROPOSAL_SYSTEM_PROMPT).toContain('Do not invent file paths');
  });
});

describe('buildFixProposalUserPrompt', () => {
  it('embeds the bug context, hypothesis, and confirmed root cause', () => {
    const prompt = buildFixProposalUserPrompt({
      bugContext,
      hypothesis,
      rootCauseAnalysis: confirmedAnalysis,
    });
    expect(prompt).toContain('Pagination resets on filter change');
    expect(prompt).toContain('id: h1');
    expect(prompt).toContain('### Confirmed root cause');
    expect(prompt).toContain('UsersPage passes filter as React key');
    expect(prompt).toContain('src/app/users/page.tsx:2');
    expect(prompt).toContain('Propose 1-3 fix options');
  });
});

describe('generateFixProposal', () => {
  it('forwards the system prompt and FixProposalSchema to the LLM', async () => {
    const generate = vi.fn().mockResolvedValue(sampleProposal);
    const llm: LLMProvider = { generateStructured: generate };

    const result = await generateFixProposal({
      llm,
      bugContext,
      hypothesis,
      rootCauseAnalysis: confirmedAnalysis,
    });

    expect(result).toEqual(sampleProposal);
    const call = generate.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.systemPrompt).toBe(FIX_PROPOSAL_SYSTEM_PROMPT);
    expect(call.schema).toBe(FixProposalSchema);
  });

  it('refuses to generate when the root cause is not confirmed', async () => {
    const generate = vi.fn();
    const llm: LLMProvider = { generateStructured: generate };

    await expect(
      generateFixProposal({
        llm,
        bugContext,
        hypothesis,
        rootCauseAnalysis: refutedAnalysis,
      }),
    ).rejects.toBeInstanceOf(UnconfirmedRootCauseError);
    expect(generate).not.toHaveBeenCalled();
  });

  it('propagates LLM errors', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockRejectedValue(new Error('llm down')),
    };
    await expect(
      generateFixProposal({
        llm,
        bugContext,
        hypothesis,
        rootCauseAnalysis: confirmedAnalysis,
      }),
    ).rejects.toThrow('llm down');
  });
});
