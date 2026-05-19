import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { SpexError } from '../errors.js';

export class ProjectInspectionError extends SpexError {}

export class UnsupportedStackError extends SpexError {
  readonly detected: string;

  constructor(detected: string) {
    super(
      `Unsupported stack detected: ${detected}. spex init currently only supports Next.js projects.`,
    );
    this.detected = detected;
  }
}

export interface DetectedStack {
  packageName: string;
  framework: 'nextjs';
  frameworkVersion: string;
  language: 'typescript';
  styling: string;
  appRouter: boolean;
  srcDir: boolean;
  signals: DetectionSignals;
}

export interface DetectionSignals {
  framework: string;
  frameworkVersion: string;
  language: string;
  styling: string;
  appRouter: string;
  srcDir: string;
}

interface PackageJsonShape {
  name?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
}

export async function detectStack(projectDir: string): Promise<DetectedStack> {
  const pkg = await readPackageJson(projectDir);
  const packageName = readStringField(pkg.name, 'package.json#name');

  const nextRange = lookupDependency(pkg, 'next');
  if (!nextRange) {
    throw new UnsupportedStackError(
      'no "next" dependency in package.json (expected a Next.js project)',
    );
  }
  const frameworkVersion = normalizeSemverRange(nextRange);

  const hasTypeScriptDep = lookupDependency(pkg, 'typescript') !== null;
  const hasTsconfig = await fileExists(join(projectDir, 'tsconfig.json'));
  if (!hasTypeScriptDep && !hasTsconfig) {
    throw new UnsupportedStackError(
      'no TypeScript signal (missing "typescript" dependency and tsconfig.json)',
    );
  }
  const languageSignal = hasTsconfig
    ? hasTypeScriptDep
      ? 'tsconfig.json present and "typescript" devDependency declared'
      : 'tsconfig.json present at project root'
    : '"typescript" devDependency declared';

  const tailwindRange = lookupDependency(pkg, 'tailwindcss');
  const tailwindConfigFile = await firstExistingFile(projectDir, [
    'tailwind.config.ts',
    'tailwind.config.js',
    'tailwind.config.mjs',
    'tailwind.config.cjs',
  ]);
  let styling: string;
  let stylingSignal: string;
  if (tailwindRange || tailwindConfigFile) {
    styling = 'tailwindcss';
    stylingSignal = tailwindConfigFile
      ? `tailwind config file found: ${tailwindConfigFile}`
      : `"tailwindcss" dependency at ${tailwindRange ?? 'unknown'}`;
  } else {
    styling = 'css';
    stylingSignal = 'no tailwind config or dependency detected; defaulting to "css"';
  }

  const srcAppDir = await directoryExists(join(projectDir, 'src', 'app'));
  const rootAppDir = !srcAppDir && (await directoryExists(join(projectDir, 'app')));
  const appRouter = srcAppDir || rootAppDir;
  const appRouterSignal = srcAppDir
    ? 'src/app/ directory present'
    : rootAppDir
      ? 'app/ directory present at project root'
      : 'no app/ directory found; assuming Pages Router or empty project';

  const srcDir = await directoryExists(join(projectDir, 'src'));
  const srcDirSignal = srcDir ? 'src/ directory present' : 'no src/ directory at project root';

  return {
    packageName,
    framework: 'nextjs',
    frameworkVersion,
    language: 'typescript',
    styling,
    appRouter,
    srcDir,
    signals: {
      framework: `"next" dependency declared at ${nextRange}`,
      frameworkVersion: `parsed from "next" range "${nextRange}"`,
      language: languageSignal,
      styling: stylingSignal,
      appRouter: appRouterSignal,
      srcDir: srcDirSignal,
    },
  };
}

async function readPackageJson(projectDir: string): Promise<PackageJsonShape> {
  const path = join(projectDir, 'package.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    throw new ProjectInspectionError(
      `Cannot read package.json at ${path}. Run spex init from a project root.`,
      { cause },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ProjectInspectionError(`Invalid JSON in package.json at ${path}.`, { cause });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProjectInspectionError(`package.json at ${path} is not a JSON object.`);
  }
  return parsed as PackageJsonShape;
}

function readStringField(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProjectInspectionError(`Missing or invalid ${label}.`);
  }
  return value;
}

function lookupDependency(pkg: PackageJsonShape, name: string): string | null {
  for (const bucket of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
    if (bucket && typeof bucket === 'object' && name in bucket) {
      const range = (bucket as Record<string, unknown>)[name];
      if (typeof range === 'string' && range.length > 0) {
        return range;
      }
    }
  }
  return null;
}

function normalizeSemverRange(range: string): string {
  const trimmed = range.trim().replace(/^(\^|~|>=|>|=)/, '');
  const major = /^(\d+)/.exec(trimmed);
  if (major?.[1]) {
    return major[1];
  }
  return trimmed.length > 0 ? trimmed : range;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function firstExistingFile(
  projectDir: string,
  candidates: readonly string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    if (await fileExists(join(projectDir, candidate))) {
      return candidate;
    }
  }
  return null;
}
