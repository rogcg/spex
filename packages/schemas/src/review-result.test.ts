import { describe, expect, it } from 'vitest';
import { ReviewFindingSchema, ReviewResultSchema, ReviewSectionSchema } from './review-result.js';

describe('ReviewFindingSchema', () => {
  it('parses a minimal finding', () => {
    const parsed = ReviewFindingSchema.parse({
      severity: 'minor',
      message: 'Variable name is not descriptive enough.',
    });
    expect(parsed.severity).toBe('minor');
  });

  it('accepts optional file + lines locator', () => {
    const parsed = ReviewFindingSchema.parse({
      severity: 'major',
      message: 'Unhandled null path',
      file: 'src/foo.ts',
      lines: '42-50',
    });
    expect(parsed.file).toBe('src/foo.ts');
    expect(parsed.lines).toBe('42-50');
  });

  it('rejects an unknown severity', () => {
    expect(() =>
      ReviewFindingSchema.parse({ severity: 'critical', message: 'something' }),
    ).toThrow();
  });

  it('rejects an empty message', () => {
    expect(() => ReviewFindingSchema.parse({ severity: 'info', message: '' })).toThrow();
  });
});

describe('ReviewSectionSchema', () => {
  it('accepts an empty findings list with a summary', () => {
    const parsed = ReviewSectionSchema.parse({
      findings: [],
      summary: 'No issues observed.',
    });
    expect(parsed.findings).toEqual([]);
  });

  it('rejects when summary is too short', () => {
    expect(() => ReviewSectionSchema.parse({ findings: [], summary: 'no.' })).toThrow();
  });
});

describe('ReviewResultSchema', () => {
  const emptySection = { findings: [], summary: 'No findings.' };

  it('accepts an all-green review with recommendation=approve', () => {
    const parsed = ReviewResultSchema.parse({
      spec_compliance: emptySection,
      conventions: emptySection,
      performance_security: emptySection,
      test_coverage: emptySection,
      overall_summary: 'Looks good. No blockers found.',
      recommendation: 'approve',
    });
    expect(parsed.recommendation).toBe('approve');
  });

  it('rejects when a section is missing', () => {
    expect(() =>
      ReviewResultSchema.parse({
        spec_compliance: emptySection,
        conventions: emptySection,
        test_coverage: emptySection,
        // performance_security missing
        overall_summary: 'Looks good. No blockers.',
        recommendation: 'approve',
      }),
    ).toThrow();
  });
});
