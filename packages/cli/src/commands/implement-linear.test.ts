import type { LinearIssue } from '@spex/integrations-linear';
import { describe, expect, it } from 'vitest';
import { buildDescriptionFromLinearIssue, isLinearIssueIdentifier } from './implement.js';

describe('isLinearIssueIdentifier', () => {
  it.each([
    ['SPX-47', true],
    ['ENG-1', true],
    ['LIN_OPS-9999', true],
    ['A1-1', true],
    ['lowercase-47', false],
    ['no-number-', false],
    ['SPX_47', false],
    ['SPX-', false],
    ['SPX', false],
    ['', false],
    ['SPX-47 extra', false],
  ])('classifies %s as %s', (raw, expected) => {
    expect(isLinearIssueIdentifier(raw)).toBe(expected);
  });
});

function issue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: 'uuid',
    identifier: 'SPX-47',
    title: 'Linear MCP Client',
    description: 'Sprint 6 Step 1',
    url: 'https://linear.app/spex/issue/SPX-47',
    status: { id: 's', name: 'In Progress', type: 'started' },
    team: { id: 't', key: 'SPX', name: 'SPEX' },
    assignee: null,
    labels: [],
    priority: 3,
    createdAt: '2026-05-19T00:00:00Z',
    updatedAt: '2026-05-19T00:00:00Z',
    ...overrides,
  };
}

describe('buildDescriptionFromLinearIssue', () => {
  it('joins title and description with a blank line', () => {
    const source = buildDescriptionFromLinearIssue(issue());
    expect(source).not.toBeNull();
    expect(source?.description).toBe('Linear MCP Client\n\nSprint 6 Step 1');
    expect(source?.identifier).toBe('SPX-47');
    expect(source?.url).toBe('https://linear.app/spex/issue/SPX-47');
    expect(source?.title).toBe('Linear MCP Client');
  });

  it('falls back to title-only when description is null', () => {
    const source = buildDescriptionFromLinearIssue(issue({ description: null }));
    expect(source?.description).toBe('Linear MCP Client');
  });

  it('falls back to title-only when description is whitespace', () => {
    const source = buildDescriptionFromLinearIssue(issue({ description: '   \n  ' }));
    expect(source?.description).toBe('Linear MCP Client');
  });

  it('falls back to description-only when title is whitespace', () => {
    const source = buildDescriptionFromLinearIssue(issue({ title: '   ' }));
    expect(source?.description).toBe('Sprint 6 Step 1');
    expect(source?.title).toBe('');
  });

  it('returns null when both title and description are empty', () => {
    expect(buildDescriptionFromLinearIssue(issue({ title: '', description: '' }))).toBeNull();
    expect(buildDescriptionFromLinearIssue(issue({ title: '  ', description: null }))).toBeNull();
  });

  it('trims surrounding whitespace from both fields', () => {
    const source = buildDescriptionFromLinearIssue(
      issue({ title: '  Title  ', description: '\n  Body  \n' }),
    );
    expect(source?.description).toBe('Title\n\nBody');
  });
});
