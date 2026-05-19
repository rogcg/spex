import { describe, expect, it } from 'vitest';
import { HypothesisListSchema, HypothesisSchema } from './bug-fix-hypothesis.js';

const validHypothesis = {
  id: 'h1',
  description: 'The Pagination component reads `searchParams.page` before Next.js has hydrated it.',
  confidence: 'high' as const,
  evidence: [
    'src/components/pagination.tsx:42 reads searchParams.page directly',
    'commit a1b2c3d touched the same line yesterday',
  ],
  proposedDiagnostic: 'Add a console.log in Pagination and reload to confirm initial render.',
};

const validList = {
  hypotheses: [
    validHypothesis,
    { ...validHypothesis, id: 'h2', confidence: 'medium' as const },
    { ...validHypothesis, id: 'h3', confidence: 'low' as const },
  ],
};

describe('HypothesisSchema', () => {
  it('accepts a fully populated hypothesis', () => {
    expect(HypothesisSchema.safeParse(validHypothesis).success).toBe(true);
  });

  it('rejects an invalid id pattern', () => {
    const r = HypothesisSchema.safeParse({ ...validHypothesis, id: 'H1' });
    expect(r.success).toBe(false);
  });

  it('rejects a too-short description', () => {
    expect(HypothesisSchema.safeParse({ ...validHypothesis, description: 'short' }).success).toBe(
      false,
    );
  });

  it('rejects an empty evidence array', () => {
    expect(HypothesisSchema.safeParse({ ...validHypothesis, evidence: [] }).success).toBe(false);
  });

  it('rejects an unknown confidence', () => {
    expect(HypothesisSchema.safeParse({ ...validHypothesis, confidence: 'unknown' }).success).toBe(
      false,
    );
  });

  it('rejects a too-short proposedDiagnostic', () => {
    expect(
      HypothesisSchema.safeParse({ ...validHypothesis, proposedDiagnostic: 'check' }).success,
    ).toBe(false);
  });
});

describe('HypothesisListSchema', () => {
  it('accepts a list with 3 hypotheses', () => {
    expect(HypothesisListSchema.safeParse(validList).success).toBe(true);
  });

  it('accepts a list with 5 hypotheses', () => {
    const list = {
      hypotheses: [1, 2, 3, 4, 5].map((i) => ({
        ...validHypothesis,
        id: `h${i}`,
        confidence: (i === 1 ? 'high' : i <= 3 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
      })),
    };
    expect(HypothesisListSchema.safeParse(list).success).toBe(true);
  });

  it('rejects a list with fewer than 3 hypotheses', () => {
    expect(
      HypothesisListSchema.safeParse({
        hypotheses: [
          validHypothesis,
          { ...validHypothesis, id: 'h2', confidence: 'medium' as const },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects a list with more than 5 hypotheses', () => {
    expect(
      HypothesisListSchema.safeParse({
        hypotheses: [1, 2, 3, 4, 5, 6].map((i) => ({
          ...validHypothesis,
          id: `h${i}`,
        })),
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate hypothesis ids', () => {
    expect(
      HypothesisListSchema.safeParse({
        hypotheses: [
          validHypothesis,
          { ...validHypothesis, id: 'h1', confidence: 'medium' as const },
          { ...validHypothesis, id: 'h3', confidence: 'low' as const },
        ],
      }).success,
    ).toBe(false);
  });
});
