import type { BugContext } from '@spex/schemas';
import { describe, expect, it } from 'vitest';
import {
  HYPOTHESIS_SYSTEM_PROMPT,
  buildHypothesisUserPrompt,
  formatBugContextForPrompt,
} from './prompts.js';

const fullContext: BugContext = {
  description: 'Pagination jumps to page 1 after each filter change.',
  error: {
    message: "TypeError: Cannot read property 'page' of undefined",
    stack: 'at Pagination (src/components/pagination.tsx:42:18)',
    firstOccurrence: '2026-05-17T10:00:00Z',
  },
  affectedFiles: ['src/components/pagination.tsx', 'src/app/users/page.tsx'],
  recentCommits: [
    {
      sha: 'a1b2c3d4e5f6789012345678901234567890abcd',
      message: 'feat(users): add filtering',
      date: '2026-05-17T11:00:00Z',
    },
  ],
  affectedFileContents: {
    'src/components/pagination.tsx':
      'export function Pagination({ page }: { page: number }) { return null; }\n',
  },
  errorReference: { source: 'manual', id: 'demo-1' },
};

describe('HYPOTHESIS_SYSTEM_PROMPT', () => {
  it('codifies the 3-5 ranged-output rule', () => {
    expect(HYPOTHESIS_SYSTEM_PROMPT).toContain('between 3 and 5 hypotheses');
  });

  it('requires evidence to be specific', () => {
    expect(HYPOTHESIS_SYSTEM_PROMPT).toContain('SPECIFIC evidence');
    expect(HYPOTHESIS_SYSTEM_PROMPT).toContain('not evidence');
  });

  it('requires a proposedDiagnostic per hypothesis', () => {
    expect(HYPOTHESIS_SYSTEM_PROMPT).toContain('proposedDiagnostic');
  });

  it('discourages everything-is-high-confidence outputs', () => {
    expect(HYPOTHESIS_SYSTEM_PROMPT).toContain("Don't mark every hypothesis 'high'");
  });
});

describe('formatBugContextForPrompt', () => {
  it('embeds description, error info, affected files, commits, contents, and reference', () => {
    const formatted = formatBugContextForPrompt(fullContext);
    expect(formatted).toContain('Pagination jumps to page 1');
    expect(formatted).toContain("TypeError: Cannot read property 'page'");
    expect(formatted).toContain('src/components/pagination.tsx:42:18');
    expect(formatted).toContain('firstOccurrence: 2026-05-17T10:00:00Z');
    expect(formatted).toContain('- src/components/pagination.tsx');
    expect(formatted).toContain('- src/app/users/page.tsx');
    expect(formatted).toContain('a1b2c3d4e5');
    expect(formatted).toContain('feat(users): add filtering');
    expect(formatted).toContain('=== src/components/pagination.tsx ===');
    expect(formatted).toContain('export function Pagination');
    expect(formatted).toContain('source: manual');
    expect(formatted).toContain('id: demo-1');
  });

  it('produces a usable summary when only description is present', () => {
    const minimal: BugContext = {
      description: 'mystery bug',
      affectedFiles: [],
      recentCommits: [],
    };
    const formatted = formatBugContextForPrompt(minimal);
    expect(formatted).toContain('mystery bug');
    expect(formatted).toContain('(none flagged by the reporter)');
    expect(formatted).toContain('(no git history available)');
  });
});

describe('buildHypothesisUserPrompt', () => {
  it('embeds the context summary and asks for ranked hypotheses', () => {
    const prompt = buildHypothesisUserPrompt({ bugContext: fullContext });
    expect(prompt).toContain('Pagination jumps to page 1');
    expect(prompt).toContain('Produce 3-5 ranked hypotheses for this bug.');
  });
});
