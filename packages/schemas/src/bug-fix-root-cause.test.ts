import { describe, expect, it } from 'vitest';
import { RootCauseAnalysisSchema } from './bug-fix-root-cause.js';

const validConfirmed = {
  confirmed: true,
  rootCause:
    'Pagination resets because the Users component remounts when filters change, dropping local page state.',
  evidence: [
    {
      file: 'src/app/users/page.tsx',
      lines: '12-18',
      explanation: 'Filter state is passed as a `key` prop, forcing the child to remount.',
    },
  ],
};

const validRefuted = {
  confirmed: false,
  rootCause: 'Hypothesis h1 rejected: the Pagination component uses URL state, not local state.',
  evidence: [
    {
      file: 'src/components/pagination.tsx',
      lines: '42',
      explanation: 'Reads page from `useSearchParams`, no useState involved.',
    },
  ],
  nextHypothesisToTest: 'h2 — server-side rendering loses the page param',
};

describe('RootCauseAnalysisSchema', () => {
  it('accepts a confirmed analysis without nextHypothesisToTest', () => {
    expect(RootCauseAnalysisSchema.safeParse(validConfirmed).success).toBe(true);
  });

  it('accepts a refuted analysis with nextHypothesisToTest', () => {
    expect(RootCauseAnalysisSchema.safeParse(validRefuted).success).toBe(true);
  });

  it('rejects a refuted analysis without nextHypothesisToTest', () => {
    const { nextHypothesisToTest: _omit, ...refutedWithoutNext } = validRefuted;
    expect(RootCauseAnalysisSchema.safeParse(refutedWithoutNext).success).toBe(false);
  });

  it('rejects an empty evidence array', () => {
    expect(RootCauseAnalysisSchema.safeParse({ ...validConfirmed, evidence: [] }).success).toBe(
      false,
    );
  });

  it('rejects a too-short rootCause', () => {
    expect(
      RootCauseAnalysisSchema.safeParse({ ...validConfirmed, rootCause: 'too short' }).success,
    ).toBe(false);
  });

  it('rejects evidence entries without an explanation', () => {
    expect(
      RootCauseAnalysisSchema.safeParse({
        ...validConfirmed,
        evidence: [{ file: 'src/x.ts', lines: '1', explanation: 'short' }],
      }).success,
    ).toBe(false);
  });

  it('rejects evidence with empty file path', () => {
    expect(
      RootCauseAnalysisSchema.safeParse({
        ...validConfirmed,
        evidence: [{ file: '', lines: '1-2', explanation: 'has enough text' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a refuted analysis with a blank nextHypothesisToTest', () => {
    expect(
      RootCauseAnalysisSchema.safeParse({ ...validRefuted, nextHypothesisToTest: '   ' }).success,
    ).toBe(false);
  });
});
