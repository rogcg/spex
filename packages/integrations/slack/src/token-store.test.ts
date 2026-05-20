import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SlackTokenStoreError,
  type TokenStoreOptions,
  deleteWorkspaceTokens,
  listStoredWorkspaceIds,
  loadWorkspaceTokens,
  saveWorkspaceTokens,
} from './token-store.js';
import type { SlackWorkspaceTokens } from './types.js';

async function makeOptions(): Promise<TokenStoreOptions> {
  const dir = await mkdtemp(join(tmpdir(), 'spex-slack-tokens-'));
  return { projectDir: dir, storageKey: `test-key-${Math.random().toString(36)}` };
}

const SAMPLE_TOKENS: SlackWorkspaceTokens = {
  team: { id: 'T01', name: 'Acme' },
  appId: 'A01',
  accessToken: 'xoxb-1234567890-abcdef',
  botUserId: 'B01',
  scope: 'chat:write,commands',
  installedAt: '2026-05-19T12:00:00Z',
};

describe('saveWorkspaceTokens + loadWorkspaceTokens', () => {
  it('round-trips a tokens record', async () => {
    const options = await makeOptions();
    await saveWorkspaceTokens(SAMPLE_TOKENS, options);
    const loaded = await loadWorkspaceTokens('T01', options);
    expect(loaded).toEqual(SAMPLE_TOKENS);
  });

  it('encrypts the on-disk record (no plaintext access_token visible)', async () => {
    const options = await makeOptions();
    await saveWorkspaceTokens(SAMPLE_TOKENS, options);
    const raw = await readFile(join(options.projectDir, '.ai/.slack-tokens.json'), 'utf8');
    expect(raw).not.toContain('xoxb-1234567890-abcdef');
    expect(raw).not.toContain('chat:write');
    const parsed = JSON.parse(raw);
    expect(parsed.workspaces.T01.iv).toMatch(/^[0-9a-f]+$/);
    expect(parsed.workspaces.T01.ct).toMatch(/^[0-9a-f]+$/);
  });

  it('returns null when no record exists for the team', async () => {
    const options = await makeOptions();
    expect(await loadWorkspaceTokens('T_MISSING', options)).toBeNull();
  });

  it('throws when the storage key is wrong', async () => {
    const projectDir = (await mkdtemp(join(tmpdir(), 'spex-slack-keymismatch-'))) as string;
    const writeOpts: TokenStoreOptions = { projectDir, storageKey: 'real-key' };
    const readOpts: TokenStoreOptions = { projectDir, storageKey: 'wrong-key' };
    await saveWorkspaceTokens(SAMPLE_TOKENS, writeOpts);
    await expect(loadWorkspaceTokens('T01', readOpts)).rejects.toBeInstanceOf(SlackTokenStoreError);
  });

  it('throws when the storage key env var is missing', async () => {
    const projectDir = (await mkdtemp(join(tmpdir(), 'spex-slack-nokey-'))) as string;
    const opts: TokenStoreOptions = { projectDir };
    const prior = process.env.SLACK_TOKEN_STORAGE_KEY;
    // biome-ignore lint/performance/noDelete: must truly unset; assigning undefined coerces to the string "undefined" in process.env
    delete process.env.SLACK_TOKEN_STORAGE_KEY;
    try {
      await expect(saveWorkspaceTokens(SAMPLE_TOKENS, opts)).rejects.toBeInstanceOf(
        SlackTokenStoreError,
      );
    } finally {
      if (prior !== undefined) process.env.SLACK_TOKEN_STORAGE_KEY = prior;
    }
  });

  it('overwrites an existing record for the same team', async () => {
    const options = await makeOptions();
    await saveWorkspaceTokens(SAMPLE_TOKENS, options);
    const updated: SlackWorkspaceTokens = { ...SAMPLE_TOKENS, accessToken: 'xoxb-NEW' };
    await saveWorkspaceTokens(updated, options);
    const loaded = await loadWorkspaceTokens('T01', options);
    expect(loaded?.accessToken).toBe('xoxb-NEW');
  });
});

describe('deleteWorkspaceTokens + listStoredWorkspaceIds', () => {
  it('removes the record and reflects in the listing', async () => {
    const options = await makeOptions();
    await saveWorkspaceTokens(SAMPLE_TOKENS, options);
    await saveWorkspaceTokens({ ...SAMPLE_TOKENS, team: { id: 'T02', name: 'Beta' } }, options);
    expect(await listStoredWorkspaceIds(options)).toEqual(expect.arrayContaining(['T01', 'T02']));
    expect(await deleteWorkspaceTokens('T01', options)).toBe(true);
    expect(await listStoredWorkspaceIds(options)).toEqual(['T02']);
    expect(await deleteWorkspaceTokens('T_MISSING', options)).toBe(false);
  });

  it('returns an empty list when the store file does not exist', async () => {
    const options = await makeOptions();
    expect(await listStoredWorkspaceIds(options)).toEqual([]);
  });

  it('treats a malformed store file as empty rather than crashing', async () => {
    const options = await makeOptions();
    const path = join(options.projectDir, '.ai/.slack-tokens.json');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(options.projectDir, '.ai'), { recursive: true });
    await writeFile(path, '{"nope": true}', 'utf8');
    expect(await listStoredWorkspaceIds(options)).toEqual([]);
  });
});
