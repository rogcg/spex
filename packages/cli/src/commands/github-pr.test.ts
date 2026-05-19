import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider } from '@spex/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execaMock = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: execaMock }));

const createMock = vi.hoisted(() => vi.fn());
const addLabelsMock = vi.hoisted(() => vi.fn());
vi.mock('@spex/integrations-github', async () => {
  const actual = await vi.importActual<typeof import('@spex/integrations-github')>(
    '@spex/integrations-github',
  );
  return {
    ...actual,
    createGitHubClient: () =>
      ({
        rest: {
          pulls: { create: createMock },
          issues: { addLabels: addLabelsMock },
        },
      }) as unknown as ReturnType<typeof actual.createGitHubClient>,
  };
});

import { runGithubPrStep } from './github-pr.js';

let projectDir: string;
let originalToken: string | undefined;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

const samplePr = {
  number: 7,
  title: 'feat(x): do',
  body: 'b',
  state: 'open',
  merged: false,
  head: { ref: 'feature/x' },
  base: { ref: 'main' },
  html_url: 'https://github.com/example-org/r/pull/7',
  diff_url: 'https://github.com/example-org/r/pull/7.diff',
  created_at: '2026-05-18T00:00:00Z',
  updated_at: '2026-05-18T00:01:00Z',
  user: { login: 'example-org', html_url: 'https://github.com/example-org' },
};

const llm: LLMProvider = {
  // Always fall through to the template so polish doesn't affect the assertions.
  generateStructured: vi.fn().mockRejectedValue(new Error('skip polish')),
};

interface FeatureBaseOverrides {
  commits?: readonly { sha: string; subject: string }[];
}

function baseInput(overrides: FeatureBaseOverrides = {}) {
  return {
    kind: 'feature' as const,
    projectDir,
    branch: 'feature/x',
    commits: overrides.commits ?? [{ sha: 'abc1234567', subject: 'feat(x): add x' }],
    llm,
    autoLabel: 'feature' as const,
    feature: {
      featureSlug: 'x',
      featureTitle: 'X',
      featureDescription: 'desc',
      technicalApproach: 'approach',
      testCases: ['t'],
      filesAffected: [{ path: 'a', operation: 'create' }],
      featureSpecRelativePath: '.ai/specs/features/x/feature-spec.yaml',
    },
  };
}

beforeEach(async () => {
  projectDir = join(
    tmpdir(),
    `spex-github-pr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(projectDir, { recursive: true });
  originalToken = process.env.GITHUB_TOKEN;
  Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
  execaMock.mockReset();
  execaMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
  createMock.mockReset();
  createMock.mockResolvedValue({ data: samplePr });
  addLabelsMock.mockReset();
  addLabelsMock.mockResolvedValue({ data: [] });
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  process.exitCode = 0;
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  if (originalToken === undefined) {
    Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
  } else {
    process.env.GITHUB_TOKEN = originalToken;
  }
  process.exitCode = 0;
});

async function writeConfig(yaml: string): Promise<void> {
  await mkdir(join(projectDir, '.ai'), { recursive: true });
  await writeFile(join(projectDir, '.ai', 'config.yaml'), yaml, 'utf8');
}

describe('runGithubPrStep', () => {
  it('skips when there are no commits', async () => {
    const result = await runGithubPrStep(baseInput({ commits: [] }));
    expect(result.status).toBe('skipped');
    expect(execaMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('skips when .ai/config.yaml is missing', async () => {
    const result = await runGithubPrStep(baseInput());
    expect(result.status).toBe('skipped');
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('skips when github config is present but auto_create_pr is false', async () => {
    await writeConfig(
      'integrations:\n  github:\n    owner: example-org\n    repo: r\n    auto_create_pr: false\n',
    );
    process.env.GITHUB_TOKEN = 'tok';
    const result = await runGithubPrStep(baseInput());
    expect(result.status).toBe('skipped');
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('skips when GITHUB_TOKEN is unset, even with auto_create_pr=true', async () => {
    await writeConfig(
      'integrations:\n  github:\n    owner: example-org\n    repo: r\n    auto_create_pr: true\n',
    );
    const result = await runGithubPrStep(baseInput());
    expect(result.status).toBe('skipped');
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('skips when .ai/config.yaml is invalid', async () => {
    await writeConfig('integrations:\n  github:\n    auto_create_pr: true\n');
    process.env.GITHUB_TOKEN = 'tok';
    const result = await runGithubPrStep(baseInput());
    expect(result.status).toBe('skipped');
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('pushes, creates PR, and applies labels on the happy path', async () => {
    await writeConfig(
      [
        'integrations:',
        '  github:',
        '    owner: example-org',
        '    repo: r',
        '    auto_create_pr: true',
        '    pr_labels: [spex-generated, review-needed]',
        '    base_branch: main',
        '',
      ].join('\n'),
    );
    process.env.GITHUB_TOKEN = 'github_pat_test';

    const result = await runGithubPrStep(baseInput());

    expect(result.status).toBe('opened');
    expect(result.pullRequest?.number).toBe(7);
    expect(result.appliedLabels).toEqual(['spex-generated', 'review-needed', 'feature']);
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(addLabelsMock).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'r',
      issue_number: 7,
      labels: ['spex-generated', 'review-needed', 'feature'],
    });
  });

  it('uses fix labelling and template when kind=fix', async () => {
    await writeConfig(
      'integrations:\n  github:\n    owner: example-org\n    repo: r\n    auto_create_pr: true\n',
    );
    process.env.GITHUB_TOKEN = 'tok';

    const result = await runGithubPrStep({
      kind: 'fix',
      projectDir,
      branch: 'fix/y',
      commits: [{ sha: 'deadbeef00', subject: 'fix(y): patch' }],
      llm,
      autoLabel: 'fix',
      fix: {
        hypothesisDescription: 'Wrong reset.',
        rootCauseSummary: 'Hook fires too early.',
        selectedFixLabel: 'Move to onSuccess',
        selectedFixScope: 'narrow',
        selectedFixRisk: 'low',
        regressionTestPath: 'tests/foo.test.ts',
      },
    });

    expect(result.status).toBe('opened');
    const createArgs = createMock.mock.calls[0]?.[0] as { title: string };
    expect(createArgs.title).toMatch(/^fix:/);
    expect(addLabelsMock).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ['spex-generated', 'fix'] }),
    );
  });

  it('logs an error and sets exit code when the push fails', async () => {
    await writeConfig(
      'integrations:\n  github:\n    owner: example-org\n    repo: r\n    auto_create_pr: true\n',
    );
    process.env.GITHUB_TOKEN = 'tok';
    execaMock.mockReset();
    execaMock.mockRejectedValue(
      Object.assign(new Error('rejected'), { stderr: 'denied', exitCode: 128 }),
    );

    const result = await runGithubPrStep(baseInput());

    expect(result.status).toBe('skipped');
    expect(createMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalled();
  });
});
