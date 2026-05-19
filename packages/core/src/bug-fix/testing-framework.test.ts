import { describe, expect, it } from 'vitest';
import type { PackageJsonInfo } from '../context/types.js';
import { detectTestingFramework } from './testing-framework.js';

function pkg(overrides: Partial<PackageJsonInfo> = {}): PackageJsonInfo {
  return {
    name: 'demo',
    version: '0.0.0',
    scripts: {},
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    ...overrides,
  };
}

describe('detectTestingFramework', () => {
  it('detects vitest from devDependencies', () => {
    expect(detectTestingFramework(pkg({ devDependencies: { vitest: '^2.0.0' } }))).toEqual({
      framework: 'vitest',
      signal: expect.stringContaining('vitest'),
    });
  });

  it('detects jest from dependencies', () => {
    expect(detectTestingFramework(pkg({ dependencies: { jest: '^29.0.0' } }))).toEqual({
      framework: 'jest',
      signal: expect.stringContaining('jest'),
    });
  });

  it('prefers vitest over jest when both are declared', () => {
    expect(
      detectTestingFramework(pkg({ devDependencies: { vitest: '^2.0.0', jest: '^29.0.0' } })),
    ).toEqual({
      framework: 'vitest',
      signal: expect.stringContaining('vitest'),
    });
  });

  it('falls back to npm script signals when no dep is declared', () => {
    expect(detectTestingFramework(pkg({ scripts: { test: 'vitest run' } }))).toEqual({
      framework: 'vitest',
      signal: expect.stringContaining('npm scripts'),
    });
    expect(detectTestingFramework(pkg({ scripts: { test: 'jest --ci' } }))).toEqual({
      framework: 'jest',
      signal: expect.stringContaining('npm scripts'),
    });
  });

  it('returns null framework when no signal is found', () => {
    const result = detectTestingFramework(pkg({ scripts: { test: 'echo nope' } }));
    expect(result.framework).toBeNull();
    expect(result.signal).toContain('no vitest/jest signals');
  });
});
