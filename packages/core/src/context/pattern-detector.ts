import { basename, dirname } from 'node:path';
import type {
  ComponentStructure,
  ContextFile,
  DetectedPatterns,
  FileNamingConvention,
  TestingPattern,
} from './types.js';

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CAMEL = /^[a-z][a-zA-Z0-9]*$/;
const PASCAL = /^[A-Z][a-zA-Z0-9]*$/;

const NAMING_SAMPLE_EXTENSIONS = new Set<string>(['.ts', '.tsx', '.js', '.jsx']);

export function detectPatterns(files: readonly ContextFile[]): DetectedPatterns {
  return {
    fileNamingConvention: detectNamingConvention(files),
    componentStructure: detectComponentStructure(files),
    testingPattern: detectTestingPattern(files),
  };
}

function detectNamingConvention(files: readonly ContextFile[]): FileNamingConvention {
  const counts = { kebab: 0, camel: 0, pascal: 0, other: 0 };
  let total = 0;

  for (const file of files) {
    const name = basename(file.path);
    const ext = extensionOf(name);
    if (!NAMING_SAMPLE_EXTENSIONS.has(ext)) {
      continue;
    }
    const stem = stemOf(name);
    if (stem.length === 0) {
      continue;
    }
    if (KEBAB.test(stem)) {
      counts.kebab += 1;
    } else if (PASCAL.test(stem)) {
      counts.pascal += 1;
    } else if (CAMEL.test(stem)) {
      counts.camel += 1;
    } else {
      counts.other += 1;
    }
    total += 1;
  }

  if (total === 0) {
    return 'unknown';
  }

  const dominant = pickDominant(counts, total);
  if (!dominant) {
    return 'mixed';
  }
  return dominant;
}

function pickDominant(
  counts: { kebab: number; camel: number; pascal: number; other: number },
  total: number,
): FileNamingConvention | null {
  const threshold = total * 0.6;
  if (counts.kebab >= threshold) return 'kebab-case';
  if (counts.camel >= threshold) return 'camelCase';
  if (counts.pascal >= threshold) return 'PascalCase';
  return null;
}

function detectComponentStructure(files: readonly ContextFile[]): ComponentStructure {
  const hasComponentsDir = files.some(
    (f) => f.path.includes('/components/') || f.path.startsWith('components/'),
  );
  if (hasComponentsDir) {
    return 'components-folder';
  }
  // If there are .tsx files but no components/ folder, components are colocated.
  const hasTsxFiles = files.some((f) => f.path.endsWith('.tsx'));
  if (hasTsxFiles) {
    return 'colocated';
  }
  return 'unknown';
}

function detectTestingPattern(files: readonly ContextFile[]): TestingPattern {
  let colocated = 0;
  let inTestsDir = 0;
  let inUnderscoreTestsDir = 0;

  for (const file of files) {
    const lower = file.path.toLowerCase();
    if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(lower)) {
      continue;
    }
    const segments = file.path.split('/');
    if (segments.includes('__tests__')) {
      inUnderscoreTestsDir += 1;
    } else if (segments.includes('tests') || segments.includes('test')) {
      inTestsDir += 1;
    } else if (!isAtRoot(file.path)) {
      colocated += 1;
    } else {
      colocated += 1;
    }
  }

  const total = colocated + inTestsDir + inUnderscoreTestsDir;
  if (total === 0) {
    return 'none';
  }
  if (inUnderscoreTestsDir >= colocated && inUnderscoreTestsDir >= inTestsDir) {
    return '__tests__-folder';
  }
  if (inTestsDir >= colocated && inTestsDir >= inUnderscoreTestsDir) {
    return 'tests-folder';
  }
  return 'colocated';
}

function isAtRoot(relPath: string): boolean {
  return dirname(relPath) === '.';
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

function stemOf(name: string): string {
  // Strip a trailing ".test.ts" / ".spec.tsx" / ".d.ts" group, then the file ext.
  // We use only the primary stem for naming-convention detection.
  let stem = name;
  const sec = stem.match(/\.(test|spec)\.[cm]?[jt]sx?$/i);
  if (sec) {
    stem = stem.slice(0, stem.length - sec[0].length);
  } else if (/\.d\.ts$/.test(stem)) {
    stem = stem.slice(0, stem.length - 5);
  } else {
    const dot = stem.lastIndexOf('.');
    if (dot > 0) {
      stem = stem.slice(0, dot);
    }
  }
  return stem;
}
