import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

let workDir: string;

describe('createLogger', () => {
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'spex-logger-'));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('writes to the configured file destination when one is provided', async () => {
    const logFile = join(workDir, 'logs', 'spex.log');
    const log = createLogger({
      destination: { kind: 'file', path: logFile },
      name: 'spex-test',
      sync: true,
    });

    log.info({ hello: 'world' }, 'first');
    log.warn('second');
    log.flush();

    const content = await readFile(logFile, 'utf8');
    const lines = content
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].msg).toBe('first');
    expect(lines[0].hello).toBe('world');
    expect(lines[0].name).toBe('spex-test');
    expect(lines[1].msg).toBe('second');
    expect(lines[1].level).toBe(40);
  });

  it('honors the level option', async () => {
    const logFile = join(workDir, 'spex.log');
    const log = createLogger({
      destination: { kind: 'file', path: logFile },
      name: 'spex-test',
      level: 'warn',
      sync: true,
    });

    log.info('ignored');
    log.warn('emitted');
    log.flush();

    const content = await readFile(logFile, 'utf8');
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '').msg).toBe('emitted');
  });

  it('falls back to the env-driven destination when none is supplied', async () => {
    const logFile = join(workDir, 'env.log');
    const previous = process.env.SPEX_LOG_DEST;
    process.env.SPEX_LOG_DEST = `file:${logFile}`;
    try {
      const log = createLogger({ name: 'spex-test', sync: true });
      log.info('via env');
      log.flush();
      const content = await readFile(logFile, 'utf8');
      expect(content).toContain('"msg":"via env"');
    } finally {
      if (previous === undefined) {
        process.env.SPEX_LOG_DEST = undefined;
      } else {
        process.env.SPEX_LOG_DEST = previous;
      }
    }
  });
});
