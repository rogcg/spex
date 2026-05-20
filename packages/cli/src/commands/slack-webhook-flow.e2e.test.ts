import { createHmac } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// End-to-end coverage for `spex slack-webhook` against the built CLI binary.
// All cases use --dry-run so no SPEX flow actually runs; what we verify is
// the routing decisions the receiver makes for the three webhook shapes
// (signed slash command, signed block_actions, malformed signature).

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CLI = resolve(HERE, '..', '..', 'dist', 'index.js');
const SIGNING_SECRET = 'test-signing-secret-e2e';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'spex-slack-webhook-e2e-'));
  await mkdir(join(workDir, '.ai'), { recursive: true });
  await writeFile(
    join(workDir, '.ai', 'config.yaml'),
    [
      'integrations:',
      '  slack:',
      '    channels:',
      '      default: "#general"',
      '    slash_commands:',
      '      enabled: true',
      '      allowed_users: ["U_ADMIN"]',
      '      allowed_channels: []',
      '    approvals:',
      '      enabled: true',
      '      approvers: ["U_ADMIN"]',
      '      mode: any_of',
      '      timeout_hours: 24',
      '',
    ].join('\n'),
    'utf8',
  );
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function sign(body: string, ts: string): string {
  return `v0=${createHmac('sha256', SIGNING_SECRET).update(`v0:${ts}:${body}`).digest('hex')}`;
}

async function writeBody(body: string): Promise<string> {
  const path = join(workDir, 'body.txt');
  await writeFile(path, body, 'utf8');
  return path;
}

describe('spex slack-webhook (built CLI binary, --dry-run)', () => {
  it('dispatches an allowed /spex status slash command', async () => {
    const body = new URLSearchParams({
      team_id: 'T01',
      channel_id: 'C_GENERAL',
      user_id: 'U_ADMIN',
      user_name: 'admin',
      command: '/spex',
      text: 'status',
      response_url: 'https://hooks.slack.com/commands/x',
      trigger_id: '1.2.3',
    }).toString();
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = sign(body, ts);
    const bodyPath = await writeBody(body);
    const result = await execa(
      'node',
      [
        CLI,
        'slack-webhook',
        '--payload-path',
        bodyPath,
        '--signature',
        sig,
        '--timestamp',
        ts,
        '--secret',
        SIGNING_SECRET,
        '--dry-run',
      ],
      { cwd: workDir, reject: false, timeout: 15_000 },
    );
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('Slack signature verified');
    expect(stdout).toContain('Dispatching slash command (status)');
    expect(stdout).toContain('[dry-run]');
  });

  it('rejects a /spex implement from a non-allowlisted user', async () => {
    const body = new URLSearchParams({
      team_id: 'T01',
      channel_id: 'C_GENERAL',
      user_id: 'U_RANDO',
      user_name: 'rando',
      command: '/spex',
      text: 'implement add pagination',
      response_url: 'https://hooks.slack.com/commands/x',
      trigger_id: '1.2.3',
    }).toString();
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = sign(body, ts);
    const bodyPath = await writeBody(body);
    const result = await execa(
      'node',
      [
        CLI,
        'slack-webhook',
        '--payload-path',
        bodyPath,
        '--signature',
        sig,
        '--timestamp',
        ts,
        '--secret',
        SIGNING_SECRET,
        '--dry-run',
      ],
      { cwd: workDir, reject: false, timeout: 15_000 },
    );
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain('permission check failed');
    expect(stderr).toContain('not in allowed_users');
  });

  it('exits 1 on signature mismatch', async () => {
    const body = new URLSearchParams({
      team_id: 'T01',
      channel_id: 'C_GENERAL',
      user_id: 'U_ADMIN',
      user_name: 'admin',
      command: '/spex',
      text: 'status',
      response_url: 'https://hooks.slack.com/commands/x',
      trigger_id: '1.2.3',
    }).toString();
    const ts = Math.floor(Date.now() / 1000).toString();
    const bodyPath = await writeBody(body);
    const result = await execa(
      'node',
      [
        CLI,
        'slack-webhook',
        '--payload-path',
        bodyPath,
        '--signature',
        'v0=deadbeef',
        '--timestamp',
        ts,
        '--secret',
        SIGNING_SECRET,
        '--dry-run',
      ],
      { cwd: workDir, reject: false, timeout: 15_000 },
    );
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain('signature did not verify');
  });

  it('logs a no-op when the approval record is missing', async () => {
    const payload = {
      type: 'block_actions',
      user: { id: 'U_ADMIN', name: 'admin', team_id: 'T01' },
      team: { id: 'T01', domain: 'spex' },
      channel: { id: 'C_GENERAL', name: 'general' },
      message: { ts: '1.0', text: 'fix' },
      response_url: 'https://hooks.slack.com/actions/x',
      actions: [
        {
          action_id: 'spex_approve',
          block_id: 'spex_approval_actions',
          value: 'spex-approval-does-not-exist',
          type: 'button',
        },
      ],
    };
    const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = sign(body, ts);
    const bodyPath = await writeBody(body);
    const result = await execa(
      'node',
      [
        CLI,
        'slack-webhook',
        '--payload-path',
        bodyPath,
        '--signature',
        sig,
        '--timestamp',
        ts,
        '--secret',
        SIGNING_SECRET,
        '--dry-run',
      ],
      { cwd: workDir, reject: false, timeout: 15_000 },
    );
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('No approval record found');
    expect(stdout).toContain('spex-approval-does-not-exist');
  });

  it('exits 1 when Slack integration is missing from .ai/config.yaml', async () => {
    await writeFile(join(workDir, '.ai', 'config.yaml'), '{}\n', 'utf8');
    const body = new URLSearchParams({
      team_id: 'T01',
      channel_id: 'C_GENERAL',
      user_id: 'U_ADMIN',
      user_name: 'admin',
      command: '/spex',
      text: 'status',
      response_url: 'https://hooks.slack.com/commands/x',
      trigger_id: '1.2.3',
    }).toString();
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = sign(body, ts);
    const bodyPath = await writeBody(body);
    const result = await execa(
      'node',
      [
        CLI,
        'slack-webhook',
        '--payload-path',
        bodyPath,
        '--signature',
        sig,
        '--timestamp',
        ts,
        '--secret',
        SIGNING_SECRET,
        '--dry-run',
      ],
      { cwd: workDir, reject: false, timeout: 15_000 },
    );
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain('Slack integration not configured');
  });
});
