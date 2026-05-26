import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureEnvGitignored, loadProjectEnv, upsertEnvVar } from './env-file.js';

let projectDir: string;
const savedEnv: Record<string, string | undefined> = {};

function captureEnv(key: string): void {
  savedEnv[key] = process.env[key];
}

beforeEach(async () => {
  projectDir = join(
    tmpdir(),
    `spex-envfile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(projectDir, { recursive: true });
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('loadProjectEnv', () => {
  it('populates process.env from .env when keys are unset', async () => {
    captureEnv('SPEX_TEST_KEY_A');
    delete process.env.SPEX_TEST_KEY_A;
    await writeFile(join(projectDir, '.env'), 'SPEX_TEST_KEY_A=hello\n', 'utf8');
    loadProjectEnv(projectDir);
    expect(process.env.SPEX_TEST_KEY_A).toBe('hello');
  });

  it('does not overwrite an already-set env var', async () => {
    captureEnv('SPEX_TEST_KEY_B');
    process.env.SPEX_TEST_KEY_B = 'from-shell';
    await writeFile(join(projectDir, '.env'), 'SPEX_TEST_KEY_B=from-file\n', 'utf8');
    loadProjectEnv(projectDir);
    expect(process.env.SPEX_TEST_KEY_B).toBe('from-shell');
  });

  it('is a no-op when .env is missing', () => {
    expect(() => loadProjectEnv(projectDir)).not.toThrow();
  });

  it('skips comment and blank lines, strips surrounding quotes', async () => {
    captureEnv('SPEX_TEST_KEY_C');
    captureEnv('SPEX_TEST_KEY_D');
    delete process.env.SPEX_TEST_KEY_C;
    delete process.env.SPEX_TEST_KEY_D;
    await writeFile(
      join(projectDir, '.env'),
      '# a comment\n\nSPEX_TEST_KEY_C="quoted value"\nSPEX_TEST_KEY_D=\'single\'\n',
      'utf8',
    );
    loadProjectEnv(projectDir);
    expect(process.env.SPEX_TEST_KEY_C).toBe('quoted value');
    expect(process.env.SPEX_TEST_KEY_D).toBe('single');
  });
});

describe('upsertEnvVar', () => {
  it('creates .env when missing', async () => {
    upsertEnvVar(projectDir, 'ANTHROPIC_API_KEY', 'sk-ant-xxx');
    const content = await readFile(join(projectDir, '.env'), 'utf8');
    expect(content).toBe('ANTHROPIC_API_KEY=sk-ant-xxx\n');
  });

  it('appends a new key when the file exists', async () => {
    await writeFile(join(projectDir, '.env'), 'EXISTING=keep\n', 'utf8');
    upsertEnvVar(projectDir, 'ANTHROPIC_API_KEY', 'sk-ant-yyy');
    const content = await readFile(join(projectDir, '.env'), 'utf8');
    expect(content).toContain('EXISTING=keep');
    expect(content).toContain('ANTHROPIC_API_KEY=sk-ant-yyy');
  });

  it('replaces the existing line for the same key', async () => {
    await writeFile(
      join(projectDir, '.env'),
      'OTHER=stay\nANTHROPIC_API_KEY=old\nTRAILER=also-stay\n',
      'utf8',
    );
    upsertEnvVar(projectDir, 'ANTHROPIC_API_KEY', 'new');
    const content = await readFile(join(projectDir, '.env'), 'utf8');
    expect(content).toContain('OTHER=stay');
    expect(content).toContain('ANTHROPIC_API_KEY=new');
    expect(content).not.toContain('ANTHROPIC_API_KEY=old');
    expect(content).toContain('TRAILER=also-stay');
  });
});

describe('ensureEnvGitignored', () => {
  it('appends .env when missing from .gitignore', async () => {
    await writeFile(join(projectDir, '.gitignore'), 'node_modules/\n', 'utf8');
    ensureEnvGitignored(projectDir);
    const content = await readFile(join(projectDir, '.gitignore'), 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toMatch(/\n\.env\n$/);
  });

  it('is a no-op when .env is already ignored', async () => {
    await writeFile(join(projectDir, '.gitignore'), 'node_modules/\n.env\n', 'utf8');
    ensureEnvGitignored(projectDir);
    const content = await readFile(join(projectDir, '.gitignore'), 'utf8');
    expect(content).toBe('node_modules/\n.env\n');
  });

  it('is a no-op when .gitignore does not exist', () => {
    expect(() => ensureEnvGitignored(projectDir)).not.toThrow();
  });
});
