import { describe, expect, it } from 'vitest';
import { FixProposalSchema } from './bug-fix-proposal.js';

const minimalDiff = `--- a/src/users/page.tsx
+++ b/src/users/page.tsx
@@ -1,3 +1,3 @@
-<Users key={filter} />
+<Users />
`;

const minimalOption = {
  id: 'o1',
  label: 'Minimal patch',
  scope: 'minimal' as const,
  risk: 'low' as const,
  rationale:
    'Drop the `key={filter}` prop so the Users subtree no longer remounts on filter change.',
  diff: minimalDiff,
};

const robustOption = {
  id: 'o2',
  label: 'Robust refactor',
  scope: 'moderate' as const,
  risk: 'medium' as const,
  rationale: 'Lift the pagination state into the URL so it survives any remount of the subtree.',
  diff: minimalDiff,
};

const validProposal = {
  options: [minimalOption, robustOption],
  recommended: 'o1',
  recommendationRationale:
    'Minimal patch is enough; lifting state to the URL is broader work that should be a separate change.',
};

describe('FixProposalSchema', () => {
  it('accepts a single-option proposal', () => {
    const r = FixProposalSchema.safeParse({
      options: [minimalOption],
      recommended: 'o1',
      recommendationRationale: 'Only one sensible approach: drop the key prop to stop the remount.',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a two-option proposal', () => {
    expect(FixProposalSchema.safeParse(validProposal).success).toBe(true);
  });

  it('accepts a three-option proposal', () => {
    const three = {
      ...validProposal,
      options: [
        minimalOption,
        robustOption,
        {
          ...robustOption,
          id: 'o3',
          label: 'Full rewrite',
          scope: 'extensive' as const,
          risk: 'high' as const,
        },
      ],
      recommended: 'o2',
    };
    expect(FixProposalSchema.safeParse(three).success).toBe(true);
  });

  it('rejects a proposal with zero options', () => {
    expect(
      FixProposalSchema.safeParse({
        options: [],
        recommended: 'o1',
        recommendationRationale: 'enough explanation here',
      }).success,
    ).toBe(false);
  });

  it('rejects a proposal with four options', () => {
    const four = {
      ...validProposal,
      options: [
        minimalOption,
        { ...minimalOption, id: 'o2' },
        { ...minimalOption, id: 'o3' },
        { ...minimalOption, id: 'o4' },
      ],
    };
    expect(FixProposalSchema.safeParse(four).success).toBe(false);
  });

  it('rejects when recommended does not match any option id', () => {
    expect(FixProposalSchema.safeParse({ ...validProposal, recommended: 'o9' }).success).toBe(
      false,
    );
  });

  it('rejects duplicate option ids', () => {
    expect(
      FixProposalSchema.safeParse({
        ...validProposal,
        options: [minimalOption, { ...robustOption, id: 'o1' }],
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid id pattern', () => {
    expect(
      FixProposalSchema.safeParse({
        ...validProposal,
        options: [{ ...minimalOption, id: 'O1' }],
        recommended: 'O1',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown scope', () => {
    expect(
      FixProposalSchema.safeParse({
        ...validProposal,
        options: [{ ...minimalOption, scope: 'huge' }, robustOption],
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown risk', () => {
    expect(
      FixProposalSchema.safeParse({
        ...validProposal,
        options: [{ ...minimalOption, risk: 'extreme' }, robustOption],
      }).success,
    ).toBe(false);
  });

  it('rejects too-short rationale on an option', () => {
    expect(
      FixProposalSchema.safeParse({
        ...validProposal,
        options: [{ ...minimalOption, rationale: 'short' }, robustOption],
      }).success,
    ).toBe(false);
  });

  it('rejects an empty diff', () => {
    expect(
      FixProposalSchema.safeParse({
        ...validProposal,
        options: [{ ...minimalOption, diff: '' }, robustOption],
      }).success,
    ).toBe(false);
  });
});
