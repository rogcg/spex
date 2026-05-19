import { describe, expect, it } from 'vitest';
import { resolveLogDestination } from './destination.js';

describe('resolveLogDestination', () => {
  it('defaults to stderr when SPEX_LOG_DEST is unset', () => {
    expect(resolveLogDestination({})).toEqual({ kind: 'stderr' });
  });

  it('defaults to stderr when SPEX_LOG_DEST is an empty string', () => {
    expect(resolveLogDestination({ SPEX_LOG_DEST: '' })).toEqual({ kind: 'stderr' });
  });

  it('routes to stderr explicitly when SPEX_LOG_DEST=stderr', () => {
    expect(resolveLogDestination({ SPEX_LOG_DEST: 'stderr' })).toEqual({ kind: 'stderr' });
  });

  it('routes to stdout when SPEX_LOG_DEST=stdout', () => {
    expect(resolveLogDestination({ SPEX_LOG_DEST: 'stdout' })).toEqual({ kind: 'stdout' });
  });

  it('routes to a file path when SPEX_LOG_DEST=file:<path>', () => {
    expect(resolveLogDestination({ SPEX_LOG_DEST: 'file:/tmp/spex.log' })).toEqual({
      kind: 'file',
      path: '/tmp/spex.log',
    });
  });

  it('falls back to stderr for an unrecognised value (safe default)', () => {
    expect(resolveLogDestination({ SPEX_LOG_DEST: 'syslog' })).toEqual({ kind: 'stderr' });
  });

  it('falls back to stderr when "file:" has no path', () => {
    expect(resolveLogDestination({ SPEX_LOG_DEST: 'file:' })).toEqual({ kind: 'stderr' });
  });
});
