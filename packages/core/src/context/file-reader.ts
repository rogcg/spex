import type { Dirent, Stats } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { estimateTokens } from './token-budget.js';
import type { ContextFile } from './types.js';

// Directories never traversed, regardless of .gitignore contents.
const HARD_IGNORED_DIRS = new Set<string>([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.vercel',
  '.cache',
  '.parcel-cache',
  '.svelte-kit',
]);

// Only files matching these extensions enter the context. Keeps binary assets,
// lockfiles, and large generated artefacts out by default.
const DEFAULT_ALLOWED_EXTENSIONS = new Set<string>([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.yaml',
  '.yml',
  '.toml',
  '.css',
  '.scss',
  '.html',
]);

const DEFAULT_MAX_FILE_BYTES = 256_000;

export interface ReadProjectFilesOptions {
  projectDir: string;
  maxFileBytes?: number;
  allowedExtensions?: ReadonlySet<string>;
}

export interface ReadProjectFilesResult {
  files: ContextFile[];
  skippedTooLarge: number;
}

export async function readProjectFiles(
  options: ReadProjectFilesOptions,
): Promise<ReadProjectFilesResult> {
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const allowed = options.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS;

  const ig = ignore();
  const gitignore = await safeReadFile(join(options.projectDir, '.gitignore'));
  if (gitignore) {
    ig.add(gitignore);
  }

  const files: ContextFile[] = [];
  let skippedTooLarge = 0;
  await walk(options.projectDir, options.projectDir, ig, allowed, maxBytes, files, (reason) => {
    if (reason === 'too-large') {
      skippedTooLarge += 1;
    }
  });

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skippedTooLarge };
}

type SkipReason = 'too-large';

async function walk(
  rootDir: string,
  currentDir: string,
  ig: Ignore,
  allowed: ReadonlySet<string>,
  maxBytes: number,
  out: ContextFile[],
  onSkip: (reason: SkipReason) => void,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const absolute = join(currentDir, entry.name);
    const relativePath = toPosix(relative(rootDir, absolute));
    if (relativePath.length === 0) {
      continue;
    }

    if (entry.isDirectory()) {
      if (HARD_IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      if (ig.ignores(`${relativePath}/`)) {
        continue;
      }
      await walk(rootDir, absolute, ig, allowed, maxBytes, out, onSkip);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }
    if (ig.ignores(relativePath)) {
      continue;
    }
    if (!hasAllowedExtension(entry.name, allowed)) {
      continue;
    }

    let stats: Stats;
    try {
      stats = await stat(absolute);
    } catch {
      continue;
    }
    if (stats.size > maxBytes) {
      onSkip('too-large');
      continue;
    }

    let content: string;
    try {
      content = await readFile(absolute, 'utf8');
    } catch {
      continue;
    }

    out.push({
      path: relativePath,
      content,
      bytes: stats.size,
      estimatedTokens: estimateTokens(content),
    });
  }
}

function hasAllowedExtension(name: string, allowed: ReadonlySet<string>): boolean {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return false;
  }
  return allowed.has(name.slice(dot).toLowerCase());
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

async function safeReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
