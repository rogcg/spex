import type { FeatureSpec, TechSpec } from '@spex/schemas';
import type { CodebaseContext } from '../context/types.js';

export interface ReviewPromptContext {
  pullRequest: {
    number: number;
    title: string;
    body: string | null;
    head: string;
    base: string;
  };
  diff: string;
  featureSpec: FeatureSpec | null;
  techSpec: TechSpec | null;
  codebaseContext: CodebaseContext | null;
}

export const REVIEW_SYSTEM_PROMPT_SINGLE = [
  'You are a senior code reviewer for a project that uses SPEX, a spec-driven AI orchestration framework.',
  'You will be given a PR diff plus (optionally) the linked feature spec, the project tech spec, and a summary of the codebase patterns.',
  'Your job is to produce a SINGLE structured review that evaluates the diff across four concerns:',
  '',
  '  1. spec_compliance — does the diff implement what the linked feature spec describes? Are scope boundaries respected? Are listed test cases covered?',
  '  2. conventions — does the diff follow the established codebase patterns (file naming, component structure, testing framework, imports)?',
  '  3. performance_security — anything suspicious about new requests, queries, recursive calls, regex DoS, unvalidated input, secrets, etc.',
  '  4. test_coverage — does the diff include tests for the changes? Are the existing test cases from the spec covered?',
  '',
  'Output rules:',
  '- Each finding must have a severity (info | minor | major | blocker), a clear message, and (when applicable) a file path + line range.',
  '- Use "blocker" for things that would clearly break production or violate a stated requirement; "major" for clear correctness or convention issues; "minor" for style and small improvements; "info" for context-only notes.',
  '- Do NOT invent file paths or line numbers. If you cannot pinpoint a location, omit `file` and `lines`.',
  '- Keep messages concise (one or two sentences each).',
  '- The recommendation MUST be:',
  '    - "request_changes" if any blocker is present.',
  '    - "comment" if any major findings are present but no blockers.',
  '    - "approve" if only info/minor findings (or none) are present.',
  '- `overall_summary` should be a 2–4 sentence summary of the review.',
].join('\n');

export const REVIEW_SYSTEM_PROMPT_SECTION = (section: ReviewSectionId): string =>
  [
    'You are a senior code reviewer for a project that uses SPEX, a spec-driven AI orchestration framework.',
    `You will be given a PR diff plus (optionally) the linked feature spec, the project tech spec, and a summary of the codebase patterns. Focus EXCLUSIVELY on the "${section}" concern.`,
    '',
    SECTION_DESCRIPTIONS[section],
    '',
    'Output rules:',
    '- Each finding must have a severity (info | minor | major | blocker), a clear message, and (when applicable) a file path + line range.',
    '- Use "blocker" for things that would clearly break production or violate a stated requirement; "major" for clear correctness or convention issues; "minor" for style and small improvements; "info" for context-only notes.',
    '- Do NOT invent file paths or line numbers. If you cannot pinpoint a location, omit `file` and `lines`.',
    '- Keep messages concise (one or two sentences each).',
    `- Do NOT include findings outside the "${section}" concern.`,
    '- `summary` should be a 1–2 sentence summary of the findings for this concern.',
  ].join('\n');

export type ReviewSectionId =
  | 'spec_compliance'
  | 'conventions'
  | 'performance_security'
  | 'test_coverage';

const SECTION_DESCRIPTIONS: Record<ReviewSectionId, string> = {
  spec_compliance:
    'Spec compliance: does the diff implement what the linked feature spec describes? Are scope boundaries respected? Are listed test cases covered?',
  conventions:
    'Conventions: does the diff follow the established codebase patterns (file naming, component structure, testing framework, imports)?',
  performance_security:
    'Performance and security: anything suspicious about new requests, queries, recursive calls, regex DoS, unvalidated input, secrets, etc.',
  test_coverage:
    'Test coverage: does the diff include tests for the changes? Are the existing test cases from the spec covered?',
};

export function buildReviewUserPrompt(context: ReviewPromptContext): string {
  const parts: string[] = [];

  parts.push(`# PR #${context.pullRequest.number}: ${context.pullRequest.title}`);
  parts.push(`Branch: \`${context.pullRequest.head}\` → \`${context.pullRequest.base}\``);
  if (context.pullRequest.body && context.pullRequest.body.trim().length > 0) {
    parts.push(`\n## PR description\n\n${context.pullRequest.body.trim()}`);
  }

  if (context.featureSpec) {
    parts.push('\n## Feature spec (linked via branch convention)');
    parts.push(formatFeatureSpec(context.featureSpec));
  } else {
    parts.push('\n## Feature spec\n\n(none linked — review against tech spec + diff only)');
  }

  if (context.techSpec) {
    parts.push('\n## Tech spec (project-level)');
    parts.push(formatTechSpec(context.techSpec));
  }

  if (context.codebaseContext) {
    parts.push('\n## Codebase patterns');
    parts.push(formatPatterns(context.codebaseContext));
  }

  parts.push('\n## Unified diff');
  parts.push('```diff');
  parts.push(context.diff);
  parts.push('```');

  return parts.join('\n');
}

function formatFeatureSpec(spec: FeatureSpec): string {
  const inScope = spec.scope.in.map((s) => `  - ${s}`).join('\n');
  const outScope = spec.scope.out.map((s) => `  - ${s}`).join('\n');
  const files = spec.files_affected.map((f) => `  - \`${f.path}\` (${f.operation})`).join('\n');
  const tests = spec.test_cases.map((c) => `  - ${c}`).join('\n');
  return [
    `slug: ${spec.feature.slug}`,
    `title: ${spec.feature.title}`,
    `description: ${spec.feature.description}`,
    `technical_approach: ${spec.technical_approach}`,
    `scope.in:\n${inScope}`,
    `scope.out:\n${outScope}`,
    `files_affected:\n${files}`,
    `test_cases:\n${tests}`,
  ].join('\n');
}

function formatTechSpec(spec: TechSpec): string {
  const components = spec.stack.components.map((c) => `${c.role}=${c.choice}`).join(', ');
  return [
    `project.name: ${spec.project.name}`,
    `project.type: ${spec.project.type}`,
    `stack.label: ${spec.stack.label}`,
    `stack.components: ${components}`,
  ].join('\n');
}

function formatPatterns(context: CodebaseContext): string {
  const patterns = context.detectedPatterns;
  return [
    `file_naming: ${patterns.fileNamingConvention}`,
    `component_structure: ${patterns.componentStructure}`,
    `testing_pattern: ${patterns.testingPattern}`,
    `files_indexed: ${context.relevantFiles.length}`,
  ].join('\n');
}
