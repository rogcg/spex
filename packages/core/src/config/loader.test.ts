import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidAiConfigError, loadAiConfig } from './loader.js';

let projectDir: string;

beforeEach(async () => {
  projectDir = join(
    tmpdir(),
    `spex-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  // Best-effort cleanup; tmpdir entries are auto-rotated.
  await mkdir(projectDir, { recursive: true }).catch(() => {
    // Ignore
  });
});

describe('loadAiConfig', () => {
  it('returns null when .ai/config.yaml does not exist', async () => {
    const result = await loadAiConfig({ projectDir });
    expect(result).toBeNull();
  });

  it('returns null when only .ai/ exists but no config.yaml', async () => {
    await mkdir(join(projectDir, '.ai'), { recursive: true });
    const result = await loadAiConfig({ projectDir });
    expect(result).toBeNull();
  });

  it('parses a valid config with github integration', async () => {
    await mkdir(join(projectDir, '.ai'), { recursive: true });
    await writeFile(
      join(projectDir, '.ai', 'config.yaml'),
      [
        'integrations:',
        '  github:',
        '    owner: example-org',
        '    repo: spex-sandbox-e2e',
        '    auto_create_pr: true',
        '    pr_labels:',
        '      - spex-generated',
        '      - review-needed',
        '    base_branch: main',
        '',
      ].join('\n'),
    );
    const result = await loadAiConfig({ projectDir });
    expect(result?.integrations?.github).toMatchObject({
      owner: 'example-org',
      repo: 'spex-sandbox-e2e',
      auto_create_pr: true,
      pr_labels: ['spex-generated', 'review-needed'],
      base_branch: 'main',
      host: 'github.com',
    });
  });

  it('parses an empty config file as the empty config object', async () => {
    await mkdir(join(projectDir, '.ai'), { recursive: true });
    await writeFile(join(projectDir, '.ai', 'config.yaml'), '');
    const result = await loadAiConfig({ projectDir });
    expect(result).toEqual({});
  });

  it('throws InvalidAiConfigError when github section is missing required fields', async () => {
    await mkdir(join(projectDir, '.ai'), { recursive: true });
    await writeFile(
      join(projectDir, '.ai', 'config.yaml'),
      'integrations:\n  github:\n    auto_create_pr: true\n',
    );
    await expect(loadAiConfig({ projectDir })).rejects.toBeInstanceOf(InvalidAiConfigError);
  });

  it('throws InvalidAiConfigError when an unknown integration is configured', async () => {
    await mkdir(join(projectDir, '.ai'), { recursive: true });
    await writeFile(
      join(projectDir, '.ai', 'config.yaml'),
      'integrations:\n  gitlab:\n    token: foo\n',
    );
    await expect(loadAiConfig({ projectDir })).rejects.toBeInstanceOf(InvalidAiConfigError);
  });
});
