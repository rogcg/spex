import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type DetectedStack,
  ProjectInspectionError,
  UnsupportedStackError,
  detectStack,
} from './detect-stack.js';

let projectDir: string;

async function writeJson(file: string, content: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(content, null, 2), 'utf8');
}

async function scaffoldMinimalNextProject(opts: {
  next?: string;
  typescript?: string;
  tailwindcss?: string;
  tailwindConfig?: string;
  withTsconfig?: boolean;
  appDir?: 'src/app' | 'app' | null;
  srcDir?: boolean;
}): Promise<void> {
  const {
    next = '^15.0.0',
    typescript = '^5.0.0',
    tailwindcss = '^3.4.0',
    tailwindConfig = null,
    withTsconfig = true,
    appDir = 'src/app',
    srcDir = false,
  } = opts;

  const pkg: Record<string, unknown> = {
    name: 'demo-app',
    dependencies: { next },
    devDependencies: { typescript, ...(tailwindcss ? { tailwindcss } : {}) },
  };
  await writeJson(join(projectDir, 'package.json'), pkg);

  if (withTsconfig) {
    await writeJson(join(projectDir, 'tsconfig.json'), { compilerOptions: { strict: true } });
  }
  if (tailwindConfig) {
    await writeFile(join(projectDir, tailwindConfig), 'module.exports = {};\n', 'utf8');
  }
  if (appDir) {
    await mkdir(join(projectDir, appDir), { recursive: true });
  }
  if (srcDir) {
    await mkdir(join(projectDir, 'src'), { recursive: true });
  }
}

describe('detectStack', () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'spex-init-detect-'));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('detects a standard Next.js + TypeScript + Tailwind + App Router project', async () => {
    await scaffoldMinimalNextProject({});
    const result: DetectedStack = await detectStack(projectDir);

    expect(result.packageName).toBe('demo-app');
    expect(result.framework).toBe('nextjs');
    expect(result.frameworkVersion).toBe('15');
    expect(result.language).toBe('typescript');
    expect(result.styling).toBe('tailwindcss');
    expect(result.appRouter).toBe(true);
    expect(result.srcDir).toBe(true);
  });

  it('records human-readable provenance signals for each detected field', async () => {
    await scaffoldMinimalNextProject({});
    const result = await detectStack(projectDir);

    expect(result.signals.framework).toContain('"next"');
    expect(result.signals.frameworkVersion).toContain('15');
    expect(result.signals.language).toContain('tsconfig.json');
    expect(result.signals.styling).toContain('tailwindcss');
    expect(result.signals.appRouter).toContain('src/app');
    expect(result.signals.srcDir).toContain('src/');
  });

  it('detects app/ at project root when src/app/ is absent', async () => {
    await scaffoldMinimalNextProject({ appDir: 'app' });
    const result = await detectStack(projectDir);
    expect(result.appRouter).toBe(true);
    expect(result.signals.appRouter).toContain('app/');
  });

  it('reports appRouter=false when no app directory exists', async () => {
    await scaffoldMinimalNextProject({ appDir: null });
    const result = await detectStack(projectDir);
    expect(result.appRouter).toBe(false);
    expect(result.signals.appRouter).toContain('no app/');
  });

  it('falls back to styling="css" when Tailwind is absent', async () => {
    await scaffoldMinimalNextProject({ tailwindcss: '', appDir: null });
    const result = await detectStack(projectDir);
    expect(result.styling).toBe('css');
    expect(result.signals.styling).toContain('defaulting to "css"');
  });

  it('treats a tailwind.config.ts file as a Tailwind signal even without the dep', async () => {
    await scaffoldMinimalNextProject({ tailwindcss: '', tailwindConfig: 'tailwind.config.ts' });
    const result = await detectStack(projectDir);
    expect(result.styling).toBe('tailwindcss');
    expect(result.signals.styling).toContain('tailwind.config.ts');
  });

  it('parses major version from common semver ranges', async () => {
    await scaffoldMinimalNextProject({ next: '~14.2.0' });
    const result = await detectStack(projectDir);
    expect(result.frameworkVersion).toBe('14');
  });

  it('returns the raw range for non-numeric versions like "latest"', async () => {
    await scaffoldMinimalNextProject({ next: 'latest' });
    const result = await detectStack(projectDir);
    expect(result.frameworkVersion).toBe('latest');
  });

  it('throws ProjectInspectionError when package.json is missing', async () => {
    await expect(detectStack(projectDir)).rejects.toThrow(ProjectInspectionError);
  });

  it('throws ProjectInspectionError when package.json is malformed JSON', async () => {
    await writeFile(join(projectDir, 'package.json'), '{ not json', 'utf8');
    await expect(detectStack(projectDir)).rejects.toThrow(ProjectInspectionError);
  });

  it('throws UnsupportedStackError when "next" is missing from package.json', async () => {
    await writeJson(join(projectDir, 'package.json'), {
      name: 'demo-app',
      dependencies: { react: '^19.0.0' },
    });
    await expect(detectStack(projectDir)).rejects.toThrow(UnsupportedStackError);
  });

  it('throws UnsupportedStackError when no TypeScript signal exists', async () => {
    await writeJson(join(projectDir, 'package.json'), {
      name: 'demo-app',
      dependencies: { next: '^15.0.0' },
    });
    await expect(detectStack(projectDir)).rejects.toThrow(UnsupportedStackError);
  });
});
