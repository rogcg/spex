import { isAbsolute, relative, resolve } from 'node:path';
import { SpexError } from '../errors.js';

export class PathOutsideProjectError extends SpexError {
  readonly projectDir: string;
  readonly attemptedPath: string;

  constructor(projectDir: string, attemptedPath: string) {
    super(
      `Refusing to operate on a path outside the project root.\n  project: ${projectDir}\n  path:    ${attemptedPath}`,
    );
    this.projectDir = projectDir;
    this.attemptedPath = attemptedPath;
  }
}

/**
 * Resolve `opPath` (treated as relative to `projectDir`, unless absolute) and
 * verify it sits inside `projectDir`. Returns the absolute resolved path.
 *
 * Throws PathOutsideProjectError when the result escapes the project root.
 */
export function resolveInsideProject(projectDir: string, opPath: string): string {
  if (opPath.length === 0) {
    throw new PathOutsideProjectError(projectDir, opPath);
  }
  const absoluteProject = resolve(projectDir);
  const absoluteTarget = isAbsolute(opPath) ? resolve(opPath) : resolve(absoluteProject, opPath);
  const rel = relative(absoluteProject, absoluteTarget);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new PathOutsideProjectError(absoluteProject, absoluteTarget);
  }
  return absoluteTarget;
}
