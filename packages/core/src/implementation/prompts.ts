import type { FeatureSpec } from '@spex/schemas';
import { stringify as stringifyYaml } from 'yaml';
import type { CodebaseContext } from '../context/types.js';

export const IMPLEMENTATION_PLAN_SYSTEM_PROMPT = `You are SPEX, a senior engineer that produces concrete, file-by-file implementation plans for an approved feature spec.

Your task is to produce an ImplementationPlan that fully implements the FeatureSpec provided in the user message, against the codebase summarised in the user message.

Rules:
- feature_slug MUST match the slug in the feature spec.
- operations is an ordered list. Set order starting at 1 and increment by 1 for each operation. Order is the execution sequence — earlier operations are applied first.
- Each operation has:
  - path: relative path from the project root.
  - operation: 'create' | 'modify' | 'delete'.
  - rationale: short sentence (10+ chars) that ties the change back to the feature spec.
  - full_content: REQUIRED for 'create'. For 'modify', use full_content when the file is rewritten end-to-end; otherwise provide a diff.
  - diff: a unified diff (---/+++/@@) describing the change. Only valid for 'modify' operations.
  - 'delete' operations MUST NOT carry full_content or diff.
- Plans MUST be:
  - Atomic — operations should not depend on partial state from earlier operations being seen by the user.
  - Reversible — every operation can be undone by reading the produced full_content/diff.
- tests_to_add lists concrete test files to create. Each entry has:
  - path: where the test will live (consistent with the detected testing pattern).
  - content: the FULL test file content as it should be written.
- Honor the detected file naming convention, component structure, and testing pattern.
- Reference real existing files when proposing 'modify' or 'delete' operations. The user message provides the FULL contents for files referenced by files_affected; rely on those when producing diffs.
- Be specific. Do not propose alternatives. Do not hedge.`;

export interface BuildPlanUserPromptOptions {
  featureSpec: FeatureSpec;
  context: CodebaseContext;
}

export function buildPlanUserPrompt(opts: BuildPlanUserPromptOptions): string {
  const { featureSpec, context } = opts;
  const sections: string[] = [];

  sections.push(`### Approved feature spec\n${stringifyYaml(featureSpec, { lineWidth: 0 })}`);
  sections.push(formatCodebaseSummary(context));
  sections.push(formatTargetFileContents(featureSpec, context));
  sections.push(formatRemainingFileListing(featureSpec, context));

  return `${sections.join('\n\n')}\n\nProduce an ImplementationPlan for this feature spec.`;
}

function formatCodebaseSummary(ctx: CodebaseContext): string {
  const techSpecLine = ctx.techSpec
    ? `- tech-spec stack: ${ctx.techSpec.stack.label} (${ctx.techSpec.stack.components
        .map((c) => `${c.role}=${c.choice}`)
        .join(', ')})`
    : '- tech-spec: (none)';
  const deps = Object.keys(ctx.packageInfo.dependencies).sort();
  const devDeps = Object.keys(ctx.packageInfo.devDependencies).sort();

  return `### Codebase summary
${techSpecLine}
- package: ${ctx.packageInfo.name ?? '(unnamed)'}
- dependencies (${deps.length}): ${deps.join(', ') || '(none)'}
- devDependencies (${devDeps.length}): ${devDeps.join(', ') || '(none)'}
- file naming convention: ${ctx.detectedPatterns.fileNamingConvention}
- component structure: ${ctx.detectedPatterns.componentStructure}
- testing pattern: ${ctx.detectedPatterns.testingPattern}`;
}

function formatTargetFileContents(spec: FeatureSpec, ctx: CodebaseContext): string {
  const targets = spec.files_affected.filter(
    (f) => f.operation === 'modify' || f.operation === 'delete',
  );
  if (targets.length === 0) {
    return '### Existing file contents for target files\n(no existing files referenced by this feature spec)';
  }

  const byPath = new Map(ctx.relevantFiles.map((f) => [f.path, f]));
  const blocks: string[] = [];
  for (const target of targets) {
    const file = byPath.get(target.path);
    if (file) {
      blocks.push(
        `=== ${target.path} (${target.operation}) ===\n${file.content}=== end of ${target.path} ===`,
      );
    } else {
      blocks.push(
        `=== ${target.path} (${target.operation}) ===\n(file not found in the provided context — propose changes based on the path and the feature description, or revise the plan to not touch this file)\n=== end of ${target.path} ===`,
      );
    }
  }
  return `### Existing file contents for target files\n${blocks.join('\n\n')}`;
}

function formatRemainingFileListing(spec: FeatureSpec, ctx: CodebaseContext): string {
  const affectedPaths = new Set(spec.files_affected.map((f) => f.path));
  const others = ctx.relevantFiles
    .filter((f) => !affectedPaths.has(f.path))
    .map((f) => `- ${f.path}`);
  const truncatedNote = ctx.budget.truncated
    ? `\n(File listing truncated: ${ctx.budget.excludedFiles} file(s) excluded by token budget.)`
    : '';
  return `### Other files in the project (paths only)
${others.join('\n') || '(none)'}${truncatedNote}`;
}
