import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PathOutsideProjectError, resolveInsideProject } from './safety.js';

describe('resolveInsideProject', () => {
  const projectDir = `${sep}tmp${sep}demo`;

  it('resolves relative paths to absolute paths inside the project', () => {
    const result = resolveInsideProject(projectDir, 'src/index.ts');
    expect(result).toBe(`${projectDir}${sep}src${sep}index.ts`);
  });

  it('accepts an absolute path that lies inside the project', () => {
    const result = resolveInsideProject(projectDir, `${projectDir}${sep}src${sep}index.ts`);
    expect(result).toBe(`${projectDir}${sep}src${sep}index.ts`);
  });

  it('rejects a relative path that escapes via ..', () => {
    expect(() => resolveInsideProject(projectDir, '../outside.ts')).toThrow(
      PathOutsideProjectError,
    );
  });

  it('rejects a relative path that escapes via nested ..', () => {
    expect(() => resolveInsideProject(projectDir, 'src/../../outside.ts')).toThrow(
      PathOutsideProjectError,
    );
  });

  it('rejects an absolute path that points outside the project', () => {
    expect(() => resolveInsideProject(projectDir, `${sep}etc${sep}passwd`)).toThrow(
      PathOutsideProjectError,
    );
  });

  it('rejects an empty path', () => {
    expect(() => resolveInsideProject(projectDir, '')).toThrow(PathOutsideProjectError);
  });

  it('rejects the project root itself (no file to operate on)', () => {
    expect(() => resolveInsideProject(projectDir, '.')).toThrow(PathOutsideProjectError);
  });
});
