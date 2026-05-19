import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider } from '@spex/core';
import type { ReviewResult } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubClient } from '../client.js';
import { runReviewFlow } from './review-flow.js';

const samplePr = {
  number: 7,
  title: 'feat(add-pagination): pager component',
  body: 'PR body',
  state: 'open',
  merged: false,
  head: { ref: 'feature/add-pagination' },
  base: { ref: 'main' },
  html_url: 'https://github.com/example-org/r/pull/7',
  diff_url: 'https://github.com/example-org/r/pull/7.diff',
  created_at: '2026-05-18T00:00:00Z',
  updated_at: '2026-05-18T00:01:00Z',
  user: { login: 'example-org', html_url: 'https://github.com/example-org' },
};

const sampleComment = {
  id: 99,
  body: 'review body',
  user: { login: 'example-org', html_url: 'https://github.com/example-org' },
  created_at: '2026-05-18T00:00:00Z',
  html_url: 'https://github.com/example-org/r/pull/7#issuecomment-99',
};

const sampleResult: ReviewResult = {
  spec_compliance: { findings: [], summary: 'No issues.' },
  conventions: { findings: [], summary: 'No issues.' },
  performance_security: { findings: [], summary: 'No issues.' },
  test_coverage: { findings: [], summary: 'No issues.' },
  overall_summary: 'All good overall.',
  recommendation: 'approve',
};

let projectDir: string;
let getPrMock: ReturnType<typeof vi.fn>;
let getDiffMock: ReturnType<typeof vi.fn>;
let createCommentMock: ReturnType<typeof vi.fn>;
let client: GitHubClient;
let llm: LLMProvider;

beforeEach(async () => {
  projectDir = join(
    tmpdir(),
    `spex-review-flow-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(projectDir, { recursive: true });

  getPrMock = vi.fn().mockResolvedValue({ data: samplePr });
  // First call to pulls.get returns the PR object; second call (with mediaType=diff)
  // returns the unified diff string. We share the same mock and key on mediaType.
  getDiffMock = getPrMock; // unused — using separate calls below
  createCommentMock = vi.fn().mockResolvedValue({ data: sampleComment });

  client = {
    rest: {
      pulls: {
        get: vi.fn().mockImplementation((opts: { mediaType?: { format?: string } }) => {
          if (opts.mediaType?.format === 'diff') {
            return Promise.resolve({
              data: '--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n',
            });
          }
          return Promise.resolve({ data: samplePr });
        }),
      },
      issues: { createComment: createCommentMock },
    },
  } as unknown as GitHubClient;

  llm = {
    generateStructured: vi.fn().mockResolvedValue(sampleResult),
  };
});

afterEach(() => {
  // tmpdir entries rotate; no explicit cleanup needed.
});

describe('runReviewFlow', () => {
  it('fetches PR + diff, generates review, returns markdown, and does NOT post by default', async () => {
    const result = await runReviewFlow({
      client,
      llm,
      projectDir,
      owner: 'example-org',
      repo: 'r',
      prNumber: 7,
    });
    expect(result.result).toEqual(sampleResult);
    expect(result.markdown).toContain('# SPEX Review');
    expect(result.markdown).toContain('Approve');
    expect(result.comment).toBeNull();
    expect(createCommentMock).not.toHaveBeenCalled();
  });

  it('posts the comment when shouldPost returns true', async () => {
    const result = await runReviewFlow({
      client,
      llm,
      projectDir,
      owner: 'example-org',
      repo: 'r',
      prNumber: 7,
      shouldPost: () => true,
    });
    expect(result.comment).not.toBeNull();
    expect(result.comment?.id).toBe(99);
    expect(createCommentMock).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'r',
      issue_number: 7,
      body: result.markdown,
    });
  });

  it('skips posting when shouldPost returns false', async () => {
    const result = await runReviewFlow({
      client,
      llm,
      projectDir,
      owner: 'example-org',
      repo: 'r',
      prNumber: 7,
      shouldPost: () => false,
    });
    expect(result.comment).toBeNull();
    expect(createCommentMock).not.toHaveBeenCalled();
  });

  it('finds a linked feature spec when branch matches feature/<slug> and the file exists', async () => {
    await mkdir(join(projectDir, '.ai', 'specs'), { recursive: true });
    const specYaml = [
      'version: 1',
      'feature:',
      '  slug: add-pagination',
      '  title: Add pagination',
      '  description: Pagination feature description.',
      'scope:',
      '  in:',
      '    - paginate the list',
      '  out: []',
      'technical_approach: >',
      '  Wrap query with offset/limit and render a Pager component.',
      'files_affected:',
      '  - path: src/pager.tsx',
      '    operation: create',
      'test_cases:',
      '  - renders pager',
      'rationale: >',
      '  Solves the pagination requirement from the issue.',
      '',
    ].join('\n');
    await writeFile(join(projectDir, '.ai', 'specs', 'add-pagination.yaml'), specYaml);

    const result = await runReviewFlow({
      client,
      llm,
      projectDir,
      owner: 'example-org',
      repo: 'r',
      prNumber: 7,
    });
    expect(result.featureSpecPath).toBe('.ai/specs/add-pagination.yaml');
  });

  it('returns featureSpecPath=null when branch is not a feature/<slug> branch', async () => {
    // Override the PR mock to return a fix/ branch
    client = {
      rest: {
        pulls: {
          get: vi.fn().mockImplementation((opts: { mediaType?: { format?: string } }) => {
            if (opts.mediaType?.format === 'diff') {
              return Promise.resolve({ data: 'diff' });
            }
            return Promise.resolve({
              data: { ...samplePr, head: { ref: 'fix/some-bug' } },
            });
          }),
        },
        issues: { createComment: createCommentMock },
      },
    } as unknown as GitHubClient;

    const result = await runReviewFlow({
      client,
      llm,
      projectDir,
      owner: 'example-org',
      repo: 'r',
      prNumber: 7,
    });
    expect(result.featureSpecPath).toBeNull();
  });

  it('honours reviewMode=split (calls LLM 4 times)', async () => {
    const generateStructured = vi
      .fn()
      .mockResolvedValueOnce({ findings: [], summary: 'fine.' })
      .mockResolvedValueOnce({ findings: [], summary: 'fine.' })
      .mockResolvedValueOnce({ findings: [], summary: 'fine.' })
      .mockResolvedValueOnce({ findings: [], summary: 'fine.' });
    const splitLlm: LLMProvider = { generateStructured };

    await runReviewFlow({
      client,
      llm: splitLlm,
      projectDir,
      owner: 'example-org',
      repo: 'r',
      prNumber: 7,
      reviewMode: 'split',
    });
    expect(generateStructured).toHaveBeenCalledTimes(4);
  });
});
