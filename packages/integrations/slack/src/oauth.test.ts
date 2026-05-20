import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  SlackOAuthError,
  buildSlackInstallUrl,
  completeSlackInstall,
  exchangeSlackOAuthCode,
} from './oauth.js';
import { loadWorkspaceTokens } from './token-store.js';

function fakeWebClient(response: Record<string, unknown>) {
  return {
    oauth: {
      v2: {
        access: vi.fn(async () => response),
      },
    },
  } as unknown as import('@slack/web-api').WebClient;
}

describe('buildSlackInstallUrl', () => {
  it('builds a URL with scope, redirect, state and client_id', () => {
    const url = buildSlackInstallUrl({
      clientId: '123.456',
      redirectUri: 'https://spex.example.com/slack/oauth',
      state: 's_random',
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://slack.com');
    expect(parsed.pathname).toBe('/oauth/v2/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('123.456');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://spex.example.com/slack/oauth');
    expect(parsed.searchParams.get('state')).toBe('s_random');
    expect(parsed.searchParams.get('scope')).toContain('chat:write');
    expect(parsed.searchParams.get('scope')).toContain('commands');
  });

  it('omits user_scope when none requested', () => {
    const url = buildSlackInstallUrl({
      clientId: 'x',
      redirectUri: 'https://x/cb',
      state: 's',
    });
    expect(new URL(url).searchParams.get('user_scope')).toBeNull();
  });
});

describe('exchangeSlackOAuthCode', () => {
  it('returns a typed SlackWorkspaceTokens on success', async () => {
    const client = fakeWebClient({
      ok: true,
      access_token: 'xoxb-real',
      bot_user_id: 'B01',
      app_id: 'A01',
      scope: 'chat:write,commands',
      team: { id: 'T01', name: 'Acme' },
    });
    const tokens = await exchangeSlackOAuthCode({
      clientId: 'cid',
      clientSecret: 'csec',
      code: 'oauth-code',
      redirectUri: 'https://x/cb',
      client,
    });
    expect(tokens.accessToken).toBe('xoxb-real');
    expect(tokens.team).toEqual({ id: 'T01', name: 'Acme' });
    expect(tokens.scope).toBe('chat:write,commands');
    expect(tokens.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws SlackOAuthError when Slack returns ok=false', async () => {
    const client = fakeWebClient({ ok: false, error: 'invalid_code' });
    await expect(
      exchangeSlackOAuthCode({
        clientId: 'cid',
        clientSecret: 'csec',
        code: 'bad',
        redirectUri: 'https://x/cb',
        client,
      }),
    ).rejects.toMatchObject({ slackError: 'invalid_code' });
  });

  it('throws when the response is missing required fields', async () => {
    const client = fakeWebClient({ ok: true, access_token: 'xoxb' });
    await expect(
      exchangeSlackOAuthCode({
        clientId: 'cid',
        clientSecret: 'csec',
        code: 'code',
        redirectUri: 'https://x/cb',
        client,
      }),
    ).rejects.toBeInstanceOf(SlackOAuthError);
  });
});

describe('completeSlackInstall', () => {
  it('exchanges and persists tokens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spex-slack-oauth-'));
    const client = fakeWebClient({
      ok: true,
      access_token: 'xoxb-real',
      bot_user_id: 'B01',
      app_id: 'A01',
      scope: 'chat:write,commands',
      team: { id: 'T01', name: 'Acme' },
    });
    const tokens = await completeSlackInstall({
      clientId: 'cid',
      clientSecret: 'csec',
      code: 'code',
      redirectUri: 'https://x/cb',
      client,
      storage: { projectDir: dir, storageKey: 'test-key' },
    });
    expect(tokens.team.id).toBe('T01');
    const loaded = await loadWorkspaceTokens('T01', {
      projectDir: dir,
      storageKey: 'test-key',
    });
    expect(loaded?.accessToken).toBe('xoxb-real');
  });
});
