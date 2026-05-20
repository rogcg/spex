import { afterEach, describe, expect, it } from 'vitest';
import { MissingSlackBotTokenError, createSlackClient } from './client.js';
import type { SlackWorkspaceTokens } from './types.js';

const SAMPLE: SlackWorkspaceTokens = {
  team: { id: 'T01', name: 'Acme' },
  appId: 'A01',
  accessToken: 'xoxb-from-workspace',
  botUserId: 'B01',
  scope: 'chat:write',
  installedAt: '2026-05-19T12:00:00Z',
};

describe('createSlackClient', () => {
  const priorToken = process.env.SLACK_BOT_TOKEN;

  afterEach(() => {
    if (priorToken === undefined) {
      // biome-ignore lint/performance/noDelete: must truly unset; assigning undefined coerces to the string "undefined" in process.env
      delete process.env.SLACK_BOT_TOKEN;
    } else {
      process.env.SLACK_BOT_TOKEN = priorToken;
    }
  });

  it('resolves the bot token from the workspace bundle when provided', () => {
    // biome-ignore lint/performance/noDelete: see afterEach
    delete process.env.SLACK_BOT_TOKEN;
    const client = createSlackClient({ workspace: SAMPLE });
    expect(client.token).toBe('xoxb-from-workspace');
  });

  it('falls back to options.token when no workspace is supplied', () => {
    // biome-ignore lint/performance/noDelete: see afterEach
    delete process.env.SLACK_BOT_TOKEN;
    const client = createSlackClient({ token: 'xoxb-explicit' });
    expect(client.token).toBe('xoxb-explicit');
  });

  it('falls back to SLACK_BOT_TOKEN env var when nothing else is supplied', () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-from-env';
    const client = createSlackClient();
    expect(client.token).toBe('xoxb-from-env');
  });

  it('throws MissingSlackBotTokenError when no token is resolvable', () => {
    // biome-ignore lint/performance/noDelete: see afterEach
    delete process.env.SLACK_BOT_TOKEN;
    expect(() => createSlackClient()).toThrow(MissingSlackBotTokenError);
  });
});
