import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spexReviewToolDefinition } from './spex-review.js';

function parseTextPayload(content: unknown): Record<string, unknown> {
  if (!content || typeof content !== 'object') throw new Error('no content');
  const text = (content as { text?: unknown }).text;
  if (typeof text !== 'string') throw new Error('content has no text');
  return JSON.parse(text) as Record<string, unknown>;
}

let originalToken: string | undefined;
let originalApiKey: string | undefined;

beforeEach(() => {
  originalToken = process.env.GITHUB_TOKEN;
  originalApiKey = process.env.ANTHROPIC_API_KEY;
  Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
  Reflect.deleteProperty(process.env, 'ANTHROPIC_API_KEY');
});

afterEach(() => {
  if (originalToken === undefined) Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
  else process.env.GITHUB_TOKEN = originalToken;
  if (originalApiKey === undefined) Reflect.deleteProperty(process.env, 'ANTHROPIC_API_KEY');
  else process.env.ANTHROPIC_API_KEY = originalApiKey;
});

describe('spexReviewToolDefinition', () => {
  it('advertises spex_review with pr_ref as the only required field', () => {
    expect(spexReviewToolDefinition.tool.name).toBe('spex_review');
    const schema = spexReviewToolDefinition.tool.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.required).toEqual(['pr_ref']);
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining([
        'pr_ref',
        'project_dir',
        'owner',
        'repo',
        'review_mode',
        'auto_post',
      ]),
    );
  });

  it('rejects when pr_ref is missing', async () => {
    const result = await spexReviewToolDefinition.handle({}, {});
    expect(result.isError).toBe(true);
    const payload = parseTextPayload(result.content?.[0]);
    expect(payload.message).toContain('Invalid input');
  });

  it('rejects when pr_ref cannot be parsed', async () => {
    const result = await spexReviewToolDefinition.handle({ pr_ref: 'not-a-pr' }, {});
    expect(result.isError).toBe(true);
    const payload = parseTextPayload(result.content?.[0]);
    expect(payload.message).toContain('Invalid pr_ref');
  });

  it('rejects when owner/repo cannot be determined from ref + config + overrides', async () => {
    // Bare number with no owner/repo override and no .ai/config.yaml.
    const result = await spexReviewToolDefinition.handle(
      { pr_ref: '42', project_dir: '/tmp/empty-spex-mcp-review' },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseTextPayload(result.content?.[0]);
    expect(payload.message).toContain('owner/repo');
  });

  it('reports missing ANTHROPIC_API_KEY before contacting GitHub', async () => {
    const result = await spexReviewToolDefinition.handle(
      { pr_ref: 'https://github.com/example-org/r/pull/42' },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseTextPayload(result.content?.[0]);
    expect(payload.envVar).toBe('ANTHROPIC_API_KEY');
  });

  it('reports missing GITHUB_TOKEN when API key is present but token is not', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const result = await spexReviewToolDefinition.handle(
      { pr_ref: 'https://github.com/example-org/r/pull/42' },
      {
        // Pass a stub LLM so the handler doesn't try to construct AnthropicProvider.
        llm: { generateStructured: async () => ({}) as never },
      },
    );
    expect(result.isError).toBe(true);
    const payload = parseTextPayload(result.content?.[0]);
    expect(payload.envVar).toBe('GITHUB_TOKEN');
  });
});
