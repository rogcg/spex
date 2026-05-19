import { describe, expect, it } from 'vitest';
import { detectPatterns } from './pattern-detector.js';
import type { ContextFile } from './types.js';

function f(path: string, content = '// noop\n'): ContextFile {
  return { path, content, bytes: content.length, estimatedTokens: 1 };
}

describe('detectPatterns', () => {
  describe('fileNamingConvention', () => {
    it('returns "kebab-case" when most files use kebab-case stems', () => {
      const files = [
        f('src/tech-spec.ts'),
        f('src/detect-stack.ts'),
        f('src/inject-ai-folder.ts'),
        f('src/util.ts'),
      ];
      expect(detectPatterns(files).fileNamingConvention).toBe('kebab-case');
    });

    it('returns "PascalCase" when most files use PascalCase stems', () => {
      const files = [
        f('src/UserList.tsx'),
        f('src/UserCard.tsx'),
        f('src/LoginForm.tsx'),
        f('src/util.ts'),
      ];
      expect(detectPatterns(files).fileNamingConvention).toBe('PascalCase');
    });

    it('returns "camelCase" when most files use camelCase stems', () => {
      const files = [
        f('src/getUser.ts'),
        f('src/parseToken.ts'),
        f('src/buildContext.ts'),
        f('src/util.ts'),
      ];
      expect(detectPatterns(files).fileNamingConvention).toBe('camelCase');
    });

    it('returns "mixed" when no convention reaches the dominance threshold', () => {
      const files = [
        f('src/UserList.tsx'),
        f('src/getUser.ts'),
        f('src/tech-spec.ts'),
        f('src/util.ts'),
      ];
      expect(detectPatterns(files).fileNamingConvention).toBe('mixed');
    });

    it('returns "unknown" when there are no sample source files', () => {
      const files = [f('README.md'), f('package.json')];
      expect(detectPatterns(files).fileNamingConvention).toBe('unknown');
    });

    it('strips .test.ts before applying the convention check', () => {
      const files = [
        f('src/tech-spec.ts'),
        f('src/tech-spec.test.ts'),
        f('src/detect-stack.ts'),
        f('src/detect-stack.test.ts'),
      ];
      expect(detectPatterns(files).fileNamingConvention).toBe('kebab-case');
    });
  });

  describe('componentStructure', () => {
    it('returns "components-folder" when a components/ directory exists', () => {
      expect(
        detectPatterns([f('src/components/Button.tsx'), f('src/page.tsx')]).componentStructure,
      ).toBe('components-folder');
    });

    it('returns "colocated" when there are .tsx files but no components/ folder', () => {
      expect(
        detectPatterns([f('src/app/page.tsx'), f('src/app/layout.tsx')]).componentStructure,
      ).toBe('colocated');
    });

    it('returns "unknown" when there are no .tsx files and no components/ folder', () => {
      expect(detectPatterns([f('src/index.ts')]).componentStructure).toBe('unknown');
    });
  });

  describe('testingPattern', () => {
    it('returns "colocated" when tests sit next to source files', () => {
      expect(
        detectPatterns([
          f('src/index.ts'),
          f('src/index.test.ts'),
          f('src/util.ts'),
          f('src/util.test.ts'),
        ]).testingPattern,
      ).toBe('colocated');
    });

    it('returns "__tests__-folder" when tests live in __tests__/ directories', () => {
      expect(
        detectPatterns([
          f('src/util.ts'),
          f('src/__tests__/util.test.ts'),
          f('src/__tests__/other.test.ts'),
        ]).testingPattern,
      ).toBe('__tests__-folder');
    });

    it('returns "tests-folder" when tests live in a tests/ directory', () => {
      expect(
        detectPatterns([f('src/util.ts'), f('tests/util.test.ts'), f('tests/other.spec.ts')])
          .testingPattern,
      ).toBe('tests-folder');
    });

    it('returns "none" when no test files exist', () => {
      expect(detectPatterns([f('src/index.ts')]).testingPattern).toBe('none');
    });
  });
});
