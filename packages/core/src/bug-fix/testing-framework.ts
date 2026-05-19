import type { TestFramework } from '@spex/schemas';
import type { PackageJsonInfo } from '../context/types.js';

export interface FrameworkDetection {
  framework: TestFramework | null;
  signal: string;
}

/**
 * Detect the project's test framework from `package.json`. Vitest wins ties
 * over Jest because vitest's package presence is a stronger signal than a
 * leftover `jest` field on the root config in some monorepos.
 */
export function detectTestingFramework(packageInfo: PackageJsonInfo): FrameworkDetection {
  const allDeps = collectDeps(packageInfo);
  if (allDeps.has('vitest')) {
    return {
      framework: 'vitest',
      signal: 'vitest dependency declared in package.json',
    };
  }
  if (allDeps.has('jest')) {
    return { framework: 'jest', signal: 'jest dependency declared in package.json' };
  }
  // Fallback signals via npm scripts (rare but possible).
  const scripts = Object.values(packageInfo.scripts);
  if (scripts.some((s) => /\bvitest\b/.test(s))) {
    return {
      framework: 'vitest',
      signal: 'vitest invocation referenced in npm scripts',
    };
  }
  if (scripts.some((s) => /\bjest\b/.test(s))) {
    return {
      framework: 'jest',
      signal: 'jest invocation referenced in npm scripts',
    };
  }
  return {
    framework: null,
    signal: 'no vitest/jest signals detected in package.json',
  };
}

function collectDeps(packageInfo: PackageJsonInfo): Set<string> {
  const all = new Set<string>();
  for (const k of Object.keys(packageInfo.dependencies)) all.add(k);
  for (const k of Object.keys(packageInfo.devDependencies)) all.add(k);
  for (const k of Object.keys(packageInfo.peerDependencies)) all.add(k);
  return all;
}
