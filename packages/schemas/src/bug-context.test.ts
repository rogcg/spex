import { describe, expect, it } from 'vitest';
import { BugContextSchema } from './bug-context.js';

const valid = {
  description: 'Pagination jumps back to page 1 after the next-button click.',
  error: {
    message: "TypeError: Cannot read properties of undefined (reading 'length')",
    stack: 'at UsersPage (src/app/users/page.tsx:42:18)',
  },
  affectedFiles: ['src/app/users/page.tsx', 'src/components/pagination.tsx'],
  recentCommits: [
    {
      sha: 'a1b2c3d4e5f6789012345678901234567890abcd',
      message: 'feat(users): add pagination',
      date: '2026-05-17T10:00:00Z',
    },
    {
      sha: 'deadbee',
      message: 'fix(users): correct boundary',
      date: '2026-05-17T11:00:00Z',
    },
  ],
};

describe('BugContextSchema', () => {
  it('accepts a fully populated context', () => {
    expect(BugContextSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a context without error info', () => {
    const { error: _omit, ...minimal } = valid;
    expect(BugContextSchema.safeParse(minimal).success).toBe(true);
  });

  it('accepts an empty affectedFiles array', () => {
    expect(BugContextSchema.safeParse({ ...valid, affectedFiles: [] }).success).toBe(true);
  });

  it('accepts an empty recentCommits array', () => {
    expect(BugContextSchema.safeParse({ ...valid, recentCommits: [] }).success).toBe(true);
  });

  it('accepts an affectedFileContents map', () => {
    const result = BugContextSchema.safeParse({
      ...valid,
      affectedFileContents: {
        'src/app/users/page.tsx': 'export default function Page() { return null; }\n',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an errorReference with manual source', () => {
    expect(
      BugContextSchema.safeParse({
        ...valid,
        errorReference: { source: 'manual', id: 'user-report-1' },
      }).success,
    ).toBe(true);
  });

  it('rejects when description is empty', () => {
    expect(BugContextSchema.safeParse({ ...valid, description: '' }).success).toBe(false);
  });

  it('rejects when error has no informative fields', () => {
    expect(BugContextSchema.safeParse({ ...valid, error: {} }).success).toBe(false);
  });

  it('rejects a non-hex commit sha', () => {
    expect(
      BugContextSchema.safeParse({
        ...valid,
        recentCommits: [{ sha: 'NOTAHEX', message: 'x', date: '2026-05-17T10:00:00Z' }],
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown errorReference source', () => {
    expect(
      BugContextSchema.safeParse({
        ...valid,
        errorReference: { source: 'jira', id: 'BUG-1' },
      }).success,
    ).toBe(false);
  });
});
