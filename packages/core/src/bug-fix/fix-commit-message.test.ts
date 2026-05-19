import type { FixOption, FixProposal, Hypothesis, RootCauseAnalysis } from '@spex/schemas';
import { describe, expect, it } from 'vitest';
import {
  buildFixBranchSlug,
  buildFixCommitMessage,
  inferFixCommitScope,
} from './fix-commit-message.js';

const hypothesis: Hypothesis = {
  id: 'h1',
  description: 'Filter change passes a new key to <Users />, forcing it to remount.',
  confidence: 'high',
  evidence: ['UsersPage at src/app/users/page.tsx passes `key={filter}` to <Users />'],
  proposedDiagnostic: 'Inspect <Users /> usage in users/page.tsx for a key tied to filter.',
};

const rootCause: RootCauseAnalysis = {
  confirmed: true,
  rootCause:
    'UsersPage passes filter as the React key of <Users />, remounting the subtree on each filter change and dropping pagination state.',
  evidence: [
    {
      file: 'src/app/users/page.tsx',
      lines: '2',
      explanation: '`<Users key={filter} />` — React remounts when key changes.',
    },
  ],
};

const minimalOption: FixOption = {
  id: 'o1',
  label: 'Minimal patch',
  scope: 'minimal',
  risk: 'low',
  rationale: 'Drop the `key={filter}` so the subtree no longer remounts on filter change.',
  diff: `--- a/src/app/users/page.tsx
+++ b/src/app/users/page.tsx
@@
-<Users key={filter} />
+<Users />
`,
};

const proposal: FixProposal = {
  options: [minimalOption],
  recommended: 'o1',
  recommendationRationale: 'Smallest change that addresses the root cause.',
};

describe('inferFixCommitScope', () => {
  it('uses the directory of the file referenced by the recommended diff', () => {
    expect(inferFixCommitScope({ rootCause, recommendedOption: minimalOption })).toBe('users');
  });

  it('falls back through the root cause evidence when the diff has no path', () => {
    const opt: FixOption = { ...minimalOption, diff: '@@ no headers @@\n' };
    expect(inferFixCommitScope({ rootCause, recommendedOption: opt })).toBe('users');
  });
});

describe('buildFixCommitMessage', () => {
  it('produces a fix(scope): label header and a diagnostic body', () => {
    const message = buildFixCommitMessage({ hypothesis, rootCause, fixProposal: proposal });
    const lines = message.split('\n');
    expect(lines[0]).toBe('fix(users): Minimal patch');
    expect(message).toContain('Root cause: UsersPage passes filter as the React key');
    expect(message).toContain('Investigated hypothesis: h1 — Filter change passes a new key');
    expect(message).toContain('Chosen option: Minimal patch (scope=minimal, risk=low)');
    expect(message).toContain('Rationale: Smallest change that addresses the root cause');
  });

  it('throws when the proposal.recommended id does not match any option', () => {
    const broken: FixProposal = { ...proposal, recommended: 'o9' };
    expect(() => buildFixCommitMessage({ hypothesis, rootCause, fixProposal: broken })).toThrow(
      /recommended does not match/,
    );
  });
});

describe('buildFixBranchSlug', () => {
  it('slugifies the option label', () => {
    expect(
      buildFixBranchSlug({
        rootCause,
        recommendedOption: minimalOption,
      }),
    ).toBe('minimal-patch');
  });

  it('falls back to the root cause when the label slugifies to empty', () => {
    const opt: FixOption = { ...minimalOption, label: '!!!' };
    const slug = buildFixBranchSlug({ rootCause, recommendedOption: opt });
    expect(slug.startsWith('fix-')).toBe(true);
    expect(slug.length).toBeLessThanOrEqual(50);
  });
});
