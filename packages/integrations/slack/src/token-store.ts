import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SpexError } from '@spex/core';
import type { SlackWorkspaceTokens } from './types.js';

const DEFAULT_STORE_RELPATH = '.ai/.slack-tokens.json';
const ENCRYPTION_ENV_VAR = 'SLACK_TOKEN_STORAGE_KEY';
const ALGORITHM = 'aes-256-gcm';
const KEY_DERIVATION_SALT = 'spex:slack:token-store:v1';

export class SlackTokenStoreError extends SpexError {}

interface EncryptedRecord {
  /** Schema version. Allows future re-encryption migrations. */
  v: 1;
  /** AES-GCM initialisation vector, 12 bytes hex. */
  iv: string;
  /** AES-GCM authentication tag, 16 bytes hex. */
  tag: string;
  /** Ciphertext payload, hex-encoded. */
  ct: string;
}

interface StoreFileShape {
  /** Map of `team.id` → encrypted token record. */
  workspaces: Record<string, EncryptedRecord>;
}

export interface TokenStoreOptions {
  /** Project root. The store file is written under `<projectDir>/.ai/`. */
  projectDir: string;
  /**
   * AES-256-GCM master key. Defaults to `process.env.SLACK_TOKEN_STORAGE_KEY`.
   * Must be at least 32 bytes (after SHA-256 stretching, derived key is always
   * 32 bytes — but a short input weakens the entropy of every team's token).
   */
  storageKey?: string;
  /**
   * Override the file path. Default: `<projectDir>/.ai/.slack-tokens.json`.
   * Tests use this to keep the store out of the live `.ai/` folder.
   */
  storePath?: string;
}

function deriveKey(input: string): Buffer {
  // SHA-256 stretches the (potentially short) user-supplied key to a 32-byte
  // key that AES-256-GCM requires. Mixing in a domain salt prevents a
  // SLACK_TOKEN_STORAGE_KEY accidentally being shared with another consumer
  // that uses raw SHA-256 of the same secret.
  return createHash('sha256').update(`${KEY_DERIVATION_SALT}:${input}`).digest();
}

function encrypt(plaintext: string, key: Buffer): EncryptedRecord {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ct: ct.toString('hex'),
  };
}

function decrypt(record: EncryptedRecord, key: Buffer): string {
  const iv = Buffer.from(record.iv, 'hex');
  const tag = Buffer.from(record.tag, 'hex');
  const ct = Buffer.from(record.ct, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString('utf8');
}

async function readStoreFile(path: string): Promise<StoreFileShape> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as StoreFileShape;
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.workspaces !== 'object') {
      return { workspaces: {} };
    }
    return parsed;
  } catch (cause) {
    if (
      cause instanceof Error &&
      'code' in cause &&
      (cause as { code?: unknown }).code === 'ENOENT'
    ) {
      return { workspaces: {} };
    }
    throw new SlackTokenStoreError(
      `Failed to read Slack token store at ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

function resolveStorePath(opts: TokenStoreOptions): string {
  return opts.storePath ?? join(opts.projectDir, DEFAULT_STORE_RELPATH);
}

function resolveKey(opts: TokenStoreOptions): Buffer {
  const input = opts.storageKey ?? process.env[ENCRYPTION_ENV_VAR];
  if (input === undefined || input.length === 0) {
    throw new SlackTokenStoreError(
      `Missing required environment variable: ${ENCRYPTION_ENV_VAR}. Generate a random secret (e.g. \`openssl rand -hex 32\`) and export it before storing or reading Slack workspace tokens.`,
    );
  }
  return deriveKey(input);
}

/**
 * Persist a workspace's tokens to the encrypted on-disk store. Idempotent:
 * re-saving the same `team.id` overwrites the previous record. The plaintext
 * tokens are never written to disk; only the AES-256-GCM ciphertext is.
 */
export async function saveWorkspaceTokens(
  tokens: SlackWorkspaceTokens,
  options: TokenStoreOptions,
): Promise<void> {
  const path = resolveStorePath(options);
  const key = resolveKey(options);
  const store = await readStoreFile(path);
  store.workspaces[tokens.team.id] = encrypt(JSON.stringify(tokens), key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
}

/**
 * Load a workspace's tokens from the encrypted on-disk store. Returns `null`
 * if no record exists for `teamId` or if the store file is missing.
 *
 * Throws when the storage key is wrong (AES-GCM auth tag mismatch surfaces as
 * a decryption error) — the caller must surface that to the user since it
 * indicates either a key change or a tampered file.
 */
export async function loadWorkspaceTokens(
  teamId: string,
  options: TokenStoreOptions,
): Promise<SlackWorkspaceTokens | null> {
  const path = resolveStorePath(options);
  const store = await readStoreFile(path);
  const record = store.workspaces[teamId];
  if (record === undefined) return null;
  const key = resolveKey(options);
  let plaintext: string;
  try {
    plaintext = decrypt(record, key);
  } catch (cause) {
    throw new SlackTokenStoreError(
      `Failed to decrypt Slack tokens for team ${teamId}. The storage key may have changed or the store file may be corrupted.`,
      { cause },
    );
  }
  return JSON.parse(plaintext) as SlackWorkspaceTokens;
}

/**
 * Remove a workspace's tokens from the store (used by the uninstall flow and
 * by tests). Returns `true` if a record was removed, `false` if none existed.
 */
export async function deleteWorkspaceTokens(
  teamId: string,
  options: TokenStoreOptions,
): Promise<boolean> {
  const path = resolveStorePath(options);
  const store = await readStoreFile(path);
  if (store.workspaces[teamId] === undefined) return false;
  delete store.workspaces[teamId];
  await writeFile(path, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  return true;
}

/**
 * Enumerate the team ids that currently have tokens stored. Returns an empty
 * array if the store file does not exist.
 */
export async function listStoredWorkspaceIds(options: TokenStoreOptions): Promise<string[]> {
  const store = await readStoreFile(resolveStorePath(options));
  return Object.keys(store.workspaces);
}
