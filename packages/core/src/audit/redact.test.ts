import { describe, expect, it } from 'vitest';
import { redact } from './redact.js';

describe('redact', () => {
  it('masks Anthropic-style keys in string values', () => {
    expect(redact('curl -H "x-api-key: sk-ant-abcdef1234567890"')).not.toContain('sk-ant-abc');
  });
  it('masks GitHub tokens', () => {
    expect(redact({ note: 'token=ghp_abcdef1234567890abcdef1234567890abcd' })).toEqual({
      note: 'token=[REDACTED]',
    });
  });
  it('redacts whole values under sensitive keys', () => {
    const out = redact({
      headers: { authorization: 'Bearer something-very-long-and-secret-12345' },
      api_key: 'plain-but-under-sensitive-key',
      nested: { password: 'hunter2' },
    });
    expect(out).toEqual({
      headers: { authorization: '[REDACTED]' },
      api_key: '[REDACTED]',
      nested: { password: '[REDACTED]' },
    });
  });
  it('passes through non-sensitive data unchanged', () => {
    const input = { count: 3, items: ['a', 'b'], meta: { ok: true } };
    expect(redact(input)).toEqual(input);
  });
  it('handles arrays of nested objects', () => {
    const out = redact({
      requests: [
        { token: 'xoxb-12345-secret-blob-value' },
        { token: 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      ],
    });
    expect(out).toEqual({
      requests: [{ token: '[REDACTED]' }, { token: '[REDACTED]' }],
    });
  });
});
