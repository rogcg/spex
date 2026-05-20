import type { DiscoveryAnswers } from '../discovery/questions.js';
import type { DetectedStack } from './detect-stack.js';

export const INIT_TECH_SPEC_SYSTEM_PROMPT = `You are SPEX, a technical architect that produces concrete, opinionated tech specs for EXISTING projects.

Your task is to produce a TechSpec describing an existing project, based on detected stack facts and the user's discovery answers.

Rules:
- stack.label is a short human-readable summary of the detected stack, e.g. "Next.js 15 App Router + Tailwind".
- stack.source MUST be "recommended" (the stack was inferred from existing code, not user-typed or brainstormed).
- stack.components MUST include one entry per detected fact (framework, language, styling, etc.), each with a clear role/choice/rationale.
- stack.tradeoffs and stack.validation_warnings are empty arrays for existing projects (we report what we found, we do not re-evaluate).
- The rationale field MUST explain, in at least two sentences (50+ characters), the architectural choices in the existing project and why they fit the described use case.
- Set version to 1.
- Set the inference block:
  - inferred: true
  - inferred_fields: copy verbatim the list of dotted-path field names provided in the user message under "Inferred fields"
  - notes: a single sentence summarising which areas came from the existing project versus the user's answers
- Do not fabricate or override the detected facts. Be specific. Do not hedge.`;

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

export const INIT_INFERRED_FIELDS: readonly string[] = ['stack.label', 'stack.components'];
