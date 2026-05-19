import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SpexError } from '../errors.js';
import type { PackageJsonInfo } from './types.js';

export class PackageJsonMissingError extends SpexError {
  readonly path: string;
  constructor(path: string) {
    super(`No package.json found at ${path}. Run from a project root.`);
    this.path = path;
  }
}

export class PackageJsonInvalidError extends SpexError {
  readonly path: string;
  constructor(path: string, cause?: unknown) {
    super(`Invalid package.json at ${path}.`, cause === undefined ? undefined : { cause });
    this.path = path;
  }
}

export async function loadPackageInfo(projectDir: string): Promise<PackageJsonInfo> {
  const path = join(projectDir, 'package.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new PackageJsonMissingError(path);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new PackageJsonInvalidError(path, cause);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PackageJsonInvalidError(path);
  }

  const obj = parsed as Record<string, unknown>;
  return {
    name: stringOrNull(obj.name),
    version: stringOrNull(obj.version),
    scripts: stringRecord(obj.scripts),
    dependencies: stringRecord(obj.dependencies),
    devDependencies: stringRecord(obj.devDependencies),
    peerDependencies: stringRecord(obj.peerDependencies),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === 'string') {
      out[key] = val;
    }
  }
  return out;
}
