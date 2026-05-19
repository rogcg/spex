import type { ReviewFinding, ReviewResult, ReviewSection } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/provider.js';
import { deriveRecommendation, generateReview } from './generator.js';
import type { ReviewPromptContext } from './prompts.js';

const baseContext: ReviewPromptContext = {
  pullRequest: {
    number: 42,
    title: 'feat(x): do the thing',
    body: 'body',
    head: 'feature/x',
    base: 'main',
  },
  diff: '--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n',
  featureSpec: null,
  techSpec: null,
  codebaseContext: null,
};

const emptySection: ReviewSection = { findings: [], summary: 'No findings.' };

const fullResult: ReviewResult = {
  spec_compliance: emptySection,
  conventions: emptySection,
  performance_security: emptySection,
  test_coverage: emptySection,
  overall_summary: 'Looks good overall.',
  recommendation: 'approve',
};

describe('deriveRecommendation', () => {
  it('returns approve when there are no findings', () => {
    expect(deriveRecommendation([])).toBe('approve');
  });

  it('returns approve when only info/minor findings are present', () => {
    const findings: ReviewFinding[] = [
      { severity: 'info', message: 'note one' },
      { severity: 'minor', message: 'tiny issue' },
    ];
    expect(deriveRecommendation(findings)).toBe('approve');
  });

  it('returns comment when there is a major finding but no blockers', () => {
    const findings: ReviewFinding[] = [
      { severity: 'minor', message: 'small' },
      { severity: 'major', message: 'medium' },
    ];
    expect(deriveRecommendation(findings)).toBe('comment');
  });

  it('returns request_changes when any blocker is present', () => {
    const findings: ReviewFinding[] = [
      { severity: 'major', message: 'medium' },
      { severity: 'blocker', message: 'breaks prod' },
    ];
    expect(deriveRecommendation(findings)).toBe('request_changes');
  });
});

describe('generateReview (single mode)', () => {
  it('issues a single generateStructured call and returns its result', async () => {
    const generateStructured = vi.fn().mockResolvedValue(fullResult);
    const llm: LLMProvider = { generateStructured };

    const result = await generateReview({ llm, context: baseContext });

    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(result).toEqual(fullResult);
  });

  it('defaults to single mode when mode is not specified', async () => {
    const generateStructured = vi.fn().mockResolvedValue(fullResult);
    const llm: LLMProvider = { generateStructured };
    await generateReview({ llm, context: baseContext });
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });
});

describe('generateReview (split mode)', () => {
  it('issues four section calls and merges them with a derived recommendation', async () => {
    const generateStructured = vi
      .fn()
      .mockResolvedValueOnce({
        findings: [{ severity: 'major', message: 'spec drift' }],
        summary: 'One major spec drift.',
      })
      .mockResolvedValueOnce({ findings: [], summary: 'Conventions fine.' })
      .mockResolvedValueOnce({ findings: [], summary: 'No perf/sec issues.' })
      .mockResolvedValueOnce({
        findings: [{ severity: 'minor', message: 'add edge test' }],
        summary: 'Mostly fine.',
      });

    const llm: LLMProvider = { generateStructured };
    const result = await generateReview({ llm, context: baseContext, mode: 'split' });

    expect(generateStructured).toHaveBeenCalledTimes(4);
    expect(result.spec_compliance.findings).toHaveLength(1);
    expect(result.test_coverage.findings).toHaveLength(1);
    // major present, no blocker → "comment"
    expect(result.recommendation).toBe('comment');
    expect(result.overall_summary).toContain('2 finding');
    expect(result.overall_summary).toContain('1 major');
  });

  it('returns request_changes when any section has a blocker', async () => {
    const generateStructured = vi
      .fn()
      .mockResolvedValueOnce({ findings: [], summary: 'fine.' })
      .mockResolvedValueOnce({ findings: [], summary: 'fine.' })
      .mockResolvedValueOnce({
        findings: [{ severity: 'blocker', message: 'unvalidated user input' }],
        summary: 'One blocker.',
      })
      .mockResolvedValueOnce({ findings: [], summary: 'fine.' });

    const llm: LLMProvider = { generateStructured };
    const result = await generateReview({ llm, context: baseContext, mode: 'split' });
    expect(result.recommendation).toBe('request_changes');
  });

  it('returns approve when all sections are empty', async () => {
    const generateStructured = vi.fn().mockResolvedValue({ findings: [], summary: 'fine.' });
    const llm: LLMProvider = { generateStructured };
    const result = await generateReview({ llm, context: baseContext, mode: 'split' });
    expect(result.recommendation).toBe('approve');
    expect(result.overall_summary).toContain('0 finding');
  });
});
