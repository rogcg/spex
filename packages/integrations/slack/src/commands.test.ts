import { describe, expect, it } from 'vitest';
import { SPEX_SLASH_HELP_TEXT, checkSlashPermission, parseSpexSlashCommand } from './commands.js';
import type { SlackSlashCommand } from './types.js';

function command(overrides: Partial<SlackSlashCommand> = {}): SlackSlashCommand {
  return {
    command: '/spex',
    text: '',
    userId: 'U_ME',
    userName: 'me',
    channelId: 'C_GENERAL',
    teamId: 'T01',
    responseUrl: 'https://hooks.slack.com/commands/x',
    triggerId: '1.2.3',
    ...overrides,
  };
}

describe('parseSpexSlashCommand', () => {
  it('returns help on empty text', () => {
    expect(parseSpexSlashCommand(command()).kind).toBe('help');
  });

  it('returns help on explicit "help"', () => {
    expect(parseSpexSlashCommand(command({ text: 'help' })).kind).toBe('help');
  });

  it('returns status on "status"', () => {
    expect(parseSpexSlashCommand(command({ text: 'status' })).kind).toBe('status');
  });

  it('parses review with PR ref', () => {
    const cmd = parseSpexSlashCommand(
      command({ text: 'review https://github.com/foo/bar/pull/42' }),
    );
    expect(cmd.kind).toBe('review');
    if (cmd.kind !== 'review') throw new Error('expected review');
    expect(cmd.prRef).toBe('https://github.com/foo/bar/pull/42');
  });

  it('returns unknown when review is missing its PR ref', () => {
    const cmd = parseSpexSlashCommand(command({ text: 'review' }));
    expect(cmd.kind).toBe('unknown');
  });

  it('parses implement with multi-word description', () => {
    const cmd = parseSpexSlashCommand(
      command({ text: 'implement add pagination to the user list' }),
    );
    expect(cmd.kind).toBe('implement');
    if (cmd.kind !== 'implement') throw new Error('expected implement');
    expect(cmd.description).toBe('add pagination to the user list');
  });

  it('returns unknown when implement is missing its description', () => {
    const cmd = parseSpexSlashCommand(command({ text: 'implement' }));
    expect(cmd.kind).toBe('unknown');
  });

  it('returns unknown for unrecognised sub-commands', () => {
    const cmd = parseSpexSlashCommand(command({ text: 'blast off' }));
    expect(cmd.kind).toBe('unknown');
    if (cmd.kind !== 'unknown') throw new Error('expected unknown');
    expect(cmd.subcommand).toBe('blast');
  });

  it('threads userId / channelId / responseUrl through every variant', () => {
    const cmd = parseSpexSlashCommand(command({ text: 'status' }));
    expect(cmd.userId).toBe('U_ME');
    expect(cmd.channelId).toBe('C_GENERAL');
    expect(cmd.responseUrl).toBe('https://hooks.slack.com/commands/x');
  });
});

describe('checkSlashPermission', () => {
  it('rejects when the integration is disabled', () => {
    const result = checkSlashPermission({
      command: parseSpexSlashCommand(command({ text: 'help' })),
      config: { enabled: false },
    });
    expect(result.kind).toBe('integration_disabled');
  });

  it('allows help + status from any user when integration is enabled', () => {
    const cfg = { enabled: true, allowed_users: ['U_ADMIN'] };
    expect(
      checkSlashPermission({
        command: parseSpexSlashCommand(command({ text: 'status' })),
        config: cfg,
      }).kind,
    ).toBe('allowed');
    expect(
      checkSlashPermission({
        command: parseSpexSlashCommand(command({ text: 'help' })),
        config: cfg,
      }).kind,
    ).toBe('allowed');
  });

  it('rejects review/implement from a non-allowlisted user', () => {
    const cfg = { enabled: true, allowed_users: ['U_ADMIN'] };
    expect(
      checkSlashPermission({
        command: parseSpexSlashCommand(command({ text: 'review http://x' })),
        config: cfg,
      }).kind,
    ).toBe('user_not_allowed');
    expect(
      checkSlashPermission({
        command: parseSpexSlashCommand(command({ text: 'implement add x' })),
        config: cfg,
      }).kind,
    ).toBe('user_not_allowed');
  });

  it('allows review/implement from an allowlisted user', () => {
    const cfg = { enabled: true, allowed_users: ['U_ME'] };
    expect(
      checkSlashPermission({
        command: parseSpexSlashCommand(command({ text: 'review http://x' })),
        config: cfg,
      }).kind,
    ).toBe('allowed');
  });

  it('rejects commands from a non-allowlisted channel', () => {
    const cfg = { enabled: true, allowed_channels: ['C_OPS'] };
    const result = checkSlashPermission({
      command: parseSpexSlashCommand(command({ text: 'status' })),
      config: cfg,
    });
    expect(result.kind).toBe('channel_not_allowed');
  });

  it('allows when both gates are empty', () => {
    const result = checkSlashPermission({
      command: parseSpexSlashCommand(command({ text: 'implement add x' })),
      config: { enabled: true },
    });
    expect(result.kind).toBe('allowed');
  });
});

describe('SPEX_SLASH_HELP_TEXT', () => {
  it('mentions all three primary sub-commands', () => {
    expect(SPEX_SLASH_HELP_TEXT).toContain('/spex review');
    expect(SPEX_SLASH_HELP_TEXT).toContain('/spex implement');
    expect(SPEX_SLASH_HELP_TEXT).toContain('/spex status');
  });
});
