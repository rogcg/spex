import type { CodebaseContext } from '../context/types.js';

export const FEATURE_SPEC_SYSTEM_PROMPT = `You are SPEX, a senior engineer that produces concrete, actionable feature specs scoped to a single feature.

Your task is to produce a FeatureSpec for the user's feature request given the existing codebase context provided in the user message.

Rules:
- feature.slug must be url-safe kebab-case derived from the title (lowercase letters, digits, and dashes only, starting with a letter or digit). No spaces, no punctuation.
- feature.title is a short imperative phrase (e.g. "Add pagination to user list").
- feature.description is a one-paragraph (1-3 sentences) summary of what the feature does.
- scope.in lists what IS being built. Be concrete (e.g. "page-number stored in URL query string", not just "pagination").
- scope.out lists what is explicitly NOT in scope. Use this to set boundaries around adjacent concerns.
- technical_approach explains how the feature will be implemented at an architectural level. Reference the detected stack and any relevant existing files. 2-5 sentences.
- files_affected lists every file the implementation will touch. Use:
  - 'create' for new files;
  - 'modify' for changes to existing files;
  - 'delete' for removals.
  Paths are relative to project root. Reference files that exist in the file listing when proposing modifications.
- test_cases is one short sentence per test that should be added. Be concrete (e.g. "renders empty state when list is empty"), not generic. Include at least one test case.
- rationale explains why this approach fits the existing codebase and constraints. 2-3 sentences.
- Set version to 1.
- Honor the detected patterns (file naming, component structure, testing pattern).
- Do NOT invent files that are not consistent with the detected patterns.
- Be specific. Do not hedge. Do not propose alternatives.`;

export interface BuildFeatureSpecUserPromptOptions {
  description: string;
  context: CodebaseContext;
}

export function buildFeatureSpecUserPrompt(opts: BuildFeatureSpecUserPromptOptions): string {
  return `Feature request:
${opts.description.trim()}

Codebase context:
${formatContextForPrompt(opts.context)}

Produce a FeatureSpec for this request.`;
}

export function formatContextForPrompt(ctx: CodebaseContext): string {
  return [formatTechSpec(ctx), formatPackageInfo(ctx), formatPatterns(ctx), formatFileListing(ctx)]
    .filter((section) => section.length > 0)
    .join('\n\n');
}

function formatTechSpec(ctx: CodebaseContext): string {
  if (!ctx.techSpec) {
    return '### Tech spec\n(no .ai/tech-spec.yaml present)';
  }
  const { project, stack } = ctx.techSpec;
  const componentLines = stack.components.map((c) => `  - ${c.role}: ${c.choice}`).join('\n');
  return `### Tech spec
- project: ${project.name} (${project.type})
- description: ${project.description}
- stack: ${stack.label} (source: ${stack.source})
- components:
${componentLines}`;
}

function formatPackageInfo(ctx: CodebaseContext): string {
  const deps = Object.keys(ctx.packageInfo.dependencies).sort();
  const devDeps = Object.keys(ctx.packageInfo.devDependencies).sort();
  const scripts = Object.keys(ctx.packageInfo.scripts).sort();
  return `### Package info
- name: ${ctx.packageInfo.name ?? '(unnamed)'}
- dependencies (${deps.length}): ${deps.join(', ') || '(none)'}
- devDependencies (${devDeps.length}): ${devDeps.join(', ') || '(none)'}
- scripts (${scripts.length}): ${scripts.join(', ') || '(none)'}`;
}

function formatPatterns(ctx: CodebaseContext): string {
  const p = ctx.detectedPatterns;
  return `### Detected patterns
- file naming convention: ${p.fileNamingConvention}
- component structure: ${p.componentStructure}
- testing pattern: ${p.testingPattern}`;
}

function formatFileListing(ctx: CodebaseContext): string {
  const paths = ctx.relevantFiles.map((f) => `- ${f.path}`).join('\n');
  const truncatedNote = ctx.budget.truncated
    ? `\n(File listing truncated: ${ctx.budget.excludedFiles} file(s) excluded by token budget.)`
    : '';
  return `### File listing (${ctx.relevantFiles.length} files)
${paths}${truncatedNote}`;
}
