import { describe, expect, it } from 'vitest';
import { spexFixToolDefinition } from './spex-fix.js';

function parseTextPayload(content: unknown): Record<string, unknown> {
  if (!content || typeof content !== 'object') throw new Error('no content');
  const text = (content as { text?: unknown }).text;
  if (typeof text !== 'string') throw new Error('content has no text');
  return JSON.parse(text) as Record<string, unknown>;
}

describe('spexFixToolDefinition', () => {
  it('advertises spex_fix with description as the only required field', () => {
    expect(spexFixToolDefinition.tool.name).toBe('spex_fix');
    const schema = spexFixToolDefinition.tool.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.required).toEqual(['description']);
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining([
        'description',
        'project_dir',
        'affected_files',
        'error',
        'dry_run',
        'no_git',
        'test_command',
      ]),
    );
  });

  it('rejects invalid input', async () => {
    const result = await spexFixToolDefinition.handle({}, {});
    expect(result.isError).toBe(true);
    const payload = parseTextPayload(result.content?.[0]);
    expect(payload.message).toContain('Invalid input');
  });
});
