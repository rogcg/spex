import { resolve } from 'node:path';
import { readProjectFiles } from './file-reader.js';
import { loadPackageInfo } from './package-loader.js';
import { detectPatterns } from './pattern-detector.js';
import { loadTechSpec } from './tech-spec-loader.js';
import { DEFAULT_BUDGET_TOKENS } from './token-budget.js';
import type { CodebaseContext, ContextFile } from './types.js';

export interface BuildCodebaseContextOptions {
  projectDir: string;
  budgetTokens?: number;
  maxFileBytes?: number;
}

export async function buildCodebaseContext(
  options: BuildCodebaseContextOptions,
): Promise<CodebaseContext> {
  const projectDir = resolve(options.projectDir);
  const budgetTokens = options.budgetTokens ?? DEFAULT_BUDGET_TOKENS;

  const [packageInfo, techSpec, readResult] = await Promise.all([
    loadPackageInfo(projectDir),
    loadTechSpec(projectDir),
    readProjectFiles({
      projectDir,
      ...(options.maxFileBytes !== undefined ? { maxFileBytes: options.maxFileBytes } : {}),
    }),
  ]);

  const detectedPatterns = detectPatterns(readResult.files);
  const { kept, used, dropped } = applyBudget(readResult.files, budgetTokens);

  return {
    projectDir,
    techSpec,
    packageInfo,
    relevantFiles: kept,
    detectedPatterns,
    budget: {
      limitTokens: budgetTokens,
      usedTokens: used,
      truncated: dropped > 0,
      excludedFiles: dropped,
    },
  };
}

function applyBudget(
  files: readonly ContextFile[],
  limitTokens: number,
): { kept: ContextFile[]; used: number; dropped: number } {
  // Cheapest files first so tiny configs and the tech spec survive even when
  // a few large source files would blow the budget on their own.
  const byCost = [...files].sort((a, b) => a.estimatedTokens - b.estimatedTokens);
  const kept: ContextFile[] = [];
  let used = 0;
  let dropped = 0;

  for (const file of byCost) {
    if (used + file.estimatedTokens > limitTokens) {
      dropped += 1;
      continue;
    }
    kept.push(file);
    used += file.estimatedTokens;
  }

  kept.sort((a, b) => a.path.localeCompare(b.path));
  return { kept, used, dropped };
}
