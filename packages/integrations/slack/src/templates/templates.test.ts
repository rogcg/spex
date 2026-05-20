import { describe, expect, it } from 'vitest';
import { buildFixProposedTemplate } from './fix-proposed.js';
import { buildPrOpenedTemplate } from './pr-opened.js';
import { buildReviewCompleteTemplate } from './review-complete.js';
import { buildSpecGeneratedTemplate } from './spec-generated.js';

describe('buildPrOpenedTemplate', () => {
  it('renders header, repo/branch fields, and an Open PR button', () => {
    const m = buildPrOpenedTemplate({
      branch: 'feature/add-pagination',
      title: 'Add pagination to the user list',
      prUrl: 'https://github.com/foo/bar/pull/42',
      repo: 'foo/bar',
      source: 'implement',
    });
    expect(m.text).toContain('foo/bar');
    expect(m.blocks.find((b) => b.type === 'header')).toBeDefined();
    const actionsBlock = m.blocks.find((b) => b.type === 'actions');
    expect(actionsBlock).toBeDefined();
    expect(JSON.stringify(m.blocks)).toContain('https://github.com/foo/bar/pull/42');
  });

  it('uses the fix emoji when source is fix', () => {
    const m = buildPrOpenedTemplate({
      branch: 'feature/fix-x',
      title: 't',
      prUrl: 'https://github.com/foo/bar/pull/1',
      repo: 'foo/bar',
      source: 'fix',
    });
    const header = m.blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain('🛠️');
  });

  it('truncates very long titles', () => {
    const long = 'x'.repeat(200);
    const m = buildPrOpenedTemplate({
      branch: 'f/x',
      title: long,
      prUrl: 'https://x',
      repo: 'foo/bar',
      source: 'implement',
    });
    const titleBlock = m.blocks[1] as { text: { text: string } };
    expect(titleBlock.text.text.length).toBeLessThanOrEqual(150);
    expect(titleBlock.text.text).toContain('…');
  });
});

describe('buildFixProposedTemplate', () => {
  it('includes Approve / Reject / Inspect buttons threaded with the correlation id', () => {
    const m = buildFixProposedTemplate({
      title: 'NullPointer in checkout',
      hypothesis: 'Missing null check in validate.ts after refactor.',
      filesAffected: ['src/checkout/validate.ts', 'src/checkout/validate.test.ts'],
      origin: 'PostHog PH-1234 (23 occurrences)',
      correlationId: 'spex-approval-abc123',
    });
    const json = JSON.stringify(m.blocks);
    expect(json).toContain('spex_approve');
    expect(json).toContain('spex_reject');
    expect(json).toContain('spex_inspect');
    expect(json).toContain('spex-approval-abc123');
  });

  it('omits buttons when approvalRequested is false', () => {
    const m = buildFixProposedTemplate({
      title: 't',
      hypothesis: 'h',
      filesAffected: [],
      origin: 'manual',
      correlationId: 'spex-approval-abc',
      approvalRequested: false,
    });
    expect(m.blocks.find((b) => b.type === 'actions')).toBeUndefined();
  });
});

describe('buildSpecGeneratedTemplate', () => {
  it('summarises acceptance criteria and renders approval buttons when requested', () => {
    const m = buildSpecGeneratedTemplate({
      title: 'Add SSO',
      slug: 'add-sso',
      summary: 'Single sign-on with Google.',
      acceptanceCriteria: ['User can log in with Google', 'Sessions persist 30 days'],
      correlationId: 'spex-approval-xyz',
      approvalRequested: true,
    });
    const json = JSON.stringify(m.blocks);
    expect(json).toContain('Add SSO');
    expect(json).toContain('spex_approve');
  });

  it('omits buttons when not approval-gated', () => {
    const m = buildSpecGeneratedTemplate({
      title: 't',
      slug: 's',
      summary: 'x',
      acceptanceCriteria: [],
    });
    expect(m.blocks.find((b) => b.type === 'actions')).toBeUndefined();
  });
});

describe('buildReviewCompleteTemplate', () => {
  it('shows verdict label and the top findings', () => {
    const m = buildReviewCompleteTemplate({
      prNumber: 42,
      prTitle: 'Add SSO',
      prUrl: 'https://github.com/foo/bar/pull/42',
      repo: 'foo/bar',
      verdict: 'request_changes',
      findingCount: 5,
      topFindings: [
        { severity: 'high', summary: 'Missing tests for failure path' },
        { severity: 'medium', summary: 'Session timeout not configured' },
      ],
    });
    const json = JSON.stringify(m.blocks);
    expect(json).toContain('Changes requested');
    expect(json).toContain('Missing tests for failure path');
    expect(json).toContain('5');
  });
});
