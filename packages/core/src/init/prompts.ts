import type { DiscoveryAnswers } from '../discovery/questions.js';
import type { DetectedStack } from './detect-stack.js';

export const INIT_TECH_SPEC_SYSTEM_PROMPT = `You are SPEX, a technical architect that produces concrete, opinionated tech specs for EXISTING projects.

Your task is to produce a TechSpec describing an existing Next.js + TypeScript project, based on detected stack facts and the user's discovery answers.

Rules:
- The framework, language, version, styling, and app_router fields MUST be taken from the detected stack provided in the user message. Do NOT fabricate or override them.
- scaffolding_plan.commands MUST contain exactly one documentary placeholder: "pnpm install  # project already scaffolded"
- The rationale field MUST explain, in at least two sentences (50+ characters), the architectural choices in the existing project and why they fit the described use case.
- Set version to 1.
- Set stack.language to "typescript".
- Set stack.frontend.framework to "nextjs".
- Set stack.frontend.app_router using the detected boolean value.
- Set stack.frontend.version using the detected value.
- Set stack.frontend.styling using the detected value.
- Set the inference block:
  - inferred: true
  - inferred_fields: copy verbatim the list of dotted-path field names provided in the user message under "Inferred fields"
  - notes: a single sentence summarising which areas came from the existing project versus the user's answers
- Be specific. Do not hedge. Do not propose alternatives.`;

export function buildInitTechSpecUserPrompt(opts: {
  projectName: string;
  stack: DetectedStack;
  answers: DiscoveryAnswers;
  inferredFields: readonly string[];
}): string {
  const { projectName, stack, answers, inferredFields } = opts;
  const formattedAnswers = Object.entries(answers)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');
  const formattedInferred = inferredFields.map((field) => `- ${field}`).join('\n');

  return `Project name: ${projectName}

Detected stack (from package.json + filesystem):
- framework: ${stack.framework}
- frameworkVersion: ${stack.frameworkVersion}
- language: ${stack.language}
- styling: ${stack.styling}
- appRouter: ${stack.appRouter}
- srcDir: ${stack.srcDir}

Detection signals:
- framework: ${stack.signals.framework}
- frameworkVersion: ${stack.signals.frameworkVersion}
- language: ${stack.signals.language}
- styling: ${stack.signals.styling}
- appRouter: ${stack.signals.appRouter}

Inferred fields (copy verbatim into inference.inferred_fields):
${formattedInferred}

Discovery answers:
${formattedAnswers}

Produce a TechSpec for this existing project.`;
}

export const INIT_INFERRED_FIELDS: readonly string[] = [
  'stack.language',
  'stack.frontend.framework',
  'stack.frontend.version',
  'stack.frontend.styling',
  'stack.frontend.app_router',
];
