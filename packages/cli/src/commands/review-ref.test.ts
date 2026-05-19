import { describe, expect, it } from 'vitest';
import { InvalidPrRefError, featureSpecPathFromBranch, parsePrRef } from './review-ref.js';

describe('parsePrRef', () => {
  it('parses a bare positive number', () => {
    expect(parsePrRef('42')).toEqual({ number: 42, owner: null, repo: null });
  });

  it('trims surrounding whitespace', () => {
    expect(parsePrRef('  7  ')).toEqual({ number: 7, owner: null, repo: null });
  });

  it('parses a github.com PR URL', () => {
    expect(parsePrRef('https://github.com/example-org/spex/pull/42')).toEqual({
      number: 42,
      owner: 'example-org',
      repo: 'spex',
    });
  });

  it('accepts a URL with a trailing path component (e.g. /files)', () => {
    expect(parsePrRef('https://github.com/example-org/spex/pull/42/files')).toEqual({
      number: 42,
      owner: 'example-org',
      repo: 'spex',
    });
  });

  it('rejects a URL pointing to an issue, not a PR', () => {
    expect(() => parsePrRef('https://github.com/example-org/spex/issues/42')).toThrow(
      InvalidPrRefError,
    );
  });

  it('rejects a non-numeric bare ref', () => {
    expect(() => parsePrRef('abc')).toThrow(InvalidPrRefError);
  });

  it('rejects zero and negative numbers', () => {
    expect(() => parsePrRef('0')).toThrow(InvalidPrRefError);
    expect(() => parsePrRef('-1')).toThrow(InvalidPrRefError);
  });

  it('rejects an empty input', () => {
    expect(() => parsePrRef('')).toThrow(InvalidPrRefError);
  });
});

describe('featureSpecPathFromBranch', () => {
  it('returns the feature spec path for a feature/<slug> branch', () => {
    expect(featureSpecPathFromBranch('feature/add-pagination')).toBe(
      '.ai/specs/add-pagination.yaml',
    );
  });

  it('returns null for a fix/<slug> branch', () => {
    expect(featureSpecPathFromBranch('fix/cache-bug')).toBeNull();
  });

  it('returns null for an unrelated branch', () => {
    expect(featureSpecPathFromBranch('main')).toBeNull();
  });

  it('returns null when the slug is not kebab-safe', () => {
    expect(featureSpecPathFromBranch('feature/Has_Underscore')).toBeNull();
  });
});
