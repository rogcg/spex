import { describe, expect, it } from 'vitest';
import { UnsupportedFromErrorSourceError, parseFromError } from './fix.js';

describe('parseFromError', () => {
  it('parses the explicit `posthog:<id>` form', () => {
    expect(parseFromError('posthog:iss_abc123')).toEqual({
      source: 'posthog',
      id: 'iss_abc123',
    });
  });

  it('treats a bare id (no prefix) as posthog by default', () => {
    expect(parseFromError('iss_abc123')).toEqual({
      source: 'posthog',
      id: 'iss_abc123',
    });
  });

  it('is case-insensitive on the prefix', () => {
    expect(parseFromError('PostHog:iss_abc123')).toEqual({
      source: 'posthog',
      id: 'iss_abc123',
    });
  });

  it('trims whitespace around the value and id', () => {
    expect(parseFromError('  posthog:  iss_abc123  ')).toEqual({
      source: 'posthog',
      id: 'iss_abc123',
    });
  });

  it('throws when the value is empty', () => {
    expect(() => parseFromError('')).toThrow(/empty/);
    expect(() => parseFromError('   ')).toThrow(/empty/);
  });

  it('throws when the id portion after the prefix is empty', () => {
    expect(() => parseFromError('posthog:')).toThrow(/missing an id/);
    expect(() => parseFromError('posthog:   ')).toThrow(/missing an id/);
  });

  it('throws UnsupportedFromErrorSourceError for known-but-unwired prefixes', () => {
    expect(() => parseFromError('github:gh-9')).toThrow(UnsupportedFromErrorSourceError);
    expect(() => parseFromError('sentry:abc')).toThrow(UnsupportedFromErrorSourceError);
  });

  it('exposes the offending source on UnsupportedFromErrorSourceError', () => {
    try {
      parseFromError('github:gh-9');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedFromErrorSourceError);
      expect((err as UnsupportedFromErrorSourceError).source).toBe('github');
    }
  });
});
