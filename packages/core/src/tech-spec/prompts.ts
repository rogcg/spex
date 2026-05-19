import type { DiscoveryAnswers } from '../discovery/questions.js';

export const TECH_SPEC_SYSTEM_PROMPT = `You are SPEX, a technical architect that produces concrete, opinionated tech specs.

Your task is to produce a TechSpec for a new Next.js + TypeScript application based on the user's discovery answers.

Rules:
- The stack is fixed: TypeScript, Next.js with the App Router, Tailwind CSS for styling.
- scaffolding_plan.commands MUST contain exactly one command of the form:
  pnpm create next-app@latest <project-name> --typescript --tailwind --app --src-dir --import-alias "@/*" --use-pnpm
- The rationale field MUST explain, in at least two sentences (50+ characters), why this stack fits the described project and the user's answers.
- Set version to 1.
- Set stack.language to "typescript".
- Set stack.frontend.framework to "nextjs".
- Set stack.frontend.app_router to true.
- Set stack.frontend.version to "15" unless the user explicitly constrained it.
- Set stack.frontend.styling to "tailwindcss".
- Be specific. Do not hedge. Do not propose alternatives.`;

export function buildTechSpecUserPrompt(opts: {
  projectName: string;
  answers: DiscoveryAnswers;
}): string {
  const { projectName, answers } = opts;
  const formatted = Object.entries(answers)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');

  return `Project name: ${projectName}

Discovery answers:
${formatted}

Produce a TechSpec for this project.`;
}
