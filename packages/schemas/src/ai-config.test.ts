import { describe, expect, it } from 'vitest';
import { AiConfigSchema, GitHubIntegrationConfigSchema } from './ai-config.js';

describe('GitHubIntegrationConfigSchema', () => {
  it('parses a fully-specified github config', () => {
    const parsed = GitHubIntegrationConfigSchema.parse({
      owner: 'example-org',
      repo: 'spex-sandbox-e2e',
      auto_create_pr: true,
      pr_labels: ['spex-generated', 'review-needed'],
      base_branch: 'develop',
      host: 'ghe.example.com',
    });
    expect(parsed.owner).toBe('example-org');
    expect(parsed.auto_create_pr).toBe(true);
    expect(parsed.pr_labels).toEqual(['spex-generated', 'review-needed']);
    expect(parsed.base_branch).toBe('develop');
    expect(parsed.host).toBe('ghe.example.com');
  });

  it('applies defaults for optional fields', () => {
    const parsed = GitHubIntegrationConfigSchema.parse({
      owner: 'example-org',
      repo: 'r',
    });
    expect(parsed.auto_create_pr).toBe(false);
    expect(parsed.pr_labels).toEqual(['spex-generated']);
    expect(parsed.base_branch).toBe('main');
    expect(parsed.host).toBe('github.com');
    expect(parsed.review_mode).toBe('single');
  });

  it('accepts review_mode=split', () => {
    const parsed = GitHubIntegrationConfigSchema.parse({
      owner: 'example-org',
      repo: 'r',
      review_mode: 'split',
    });
    expect(parsed.review_mode).toBe('split');
  });

  it('rejects an unknown review_mode value', () => {
    expect(() =>
      GitHubIntegrationConfigSchema.parse({
        owner: 'example-org',
        repo: 'r',
        review_mode: 'parallel',
      }),
    ).toThrow();
  });

  it('rejects empty owner', () => {
    expect(() => GitHubIntegrationConfigSchema.parse({ owner: '', repo: 'r' })).toThrow();
  });

  it('rejects empty repo', () => {
    expect(() => GitHubIntegrationConfigSchema.parse({ owner: 'o', repo: '' })).toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() =>
      GitHubIntegrationConfigSchema.parse({ owner: 'o', repo: 'r', extra: true }),
    ).toThrow();
  });

  it('rejects empty label strings', () => {
    expect(() =>
      GitHubIntegrationConfigSchema.parse({ owner: 'o', repo: 'r', pr_labels: [''] }),
    ).toThrow();
  });
});

describe('AiConfigSchema', () => {
  it('accepts an empty config (no integrations)', () => {
    const parsed = AiConfigSchema.parse({});
    expect(parsed.integrations).toBeUndefined();
  });

  it('accepts integrations.github with all fields', () => {
    const parsed = AiConfigSchema.parse({
      integrations: {
        github: { owner: 'example-org', repo: 'r' },
      },
    });
    expect(parsed.integrations?.github?.owner).toBe('example-org');
  });

  it('rejects unknown top-level keys (strict)', () => {
    expect(() => AiConfigSchema.parse({ surprise: true })).toThrow();
  });

  it('rejects unknown keys under integrations (strict)', () => {
    expect(() => AiConfigSchema.parse({ integrations: { gitlab: {} } })).toThrow();
  });
});
