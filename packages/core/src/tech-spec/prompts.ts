import type { StackDecision } from '@spex/schemas';
import type { DiscoveryAnswers } from '../discovery/questions.js';

export const TECH_SPEC_SYSTEM_PROMPT = `You are SPEX, a technical architect that produces concrete, opinionated tech specs.

Your task is to produce a TechSpec from the user's discovery answers and a committed stack decision. The stack is NOT chosen here — it was chosen earlier by recommendStack or by the user. You package the decision into a TechSpec.

Rules:
- Set version to 1.
- project.name comes from the provided project name.
- project.type and project.description: derive concisely from the discovery answers.
- context.* maps directly from discovery answers (primary_users, expected_scale, auth_requirements, data_persistence).
- stack.label, stack.source, stack.components, stack.tradeoffs, stack.validation_warnings: copy verbatim from the committed StackDecision.
- The rationale field MUST explain, in at least two sentences (50+ characters), why the chosen stack fits the described project and the user's answers. Ground the explanation in the decision's components.
- Be specific. Do not hedge. Do not propose alternative stacks here — the stack is already decided.`;

export function buildTechSpecUserPrompt(opts: {
  projectName: string;
  answers: DiscoveryAnswers;
  decision: StackDecision;
}): string {
  const { projectName, answers, decision } = opts;
  const formatted = Object.entries(answers)
    .map(([key, value]) => `- ${key}: ${formatAnswerValue(value)}`)
    .join('\n');

  const components = decision.components
    .map((c) => `  - ${c.role}: ${c.choice} — ${c.rationale}`)
    .join('\n');

  const tradeoffs = decision.tradeoffs.length
    ? decision.tradeoffs.map((t) => `  - ${t}`).join('\n')
    : '  (none)';

  const warnings = decision.validationWarnings.length
    ? decision.validationWarnings.map((w) => `  - ${w}`).join('\n')
    : '  (none)';

  return `Project name: ${projectName}

Discovery answers:
${formatted}

Committed stack decision:
- label: ${decision.label}
- source: ${decision.source}
- rationale: ${decision.rationale}
- components:
${components}
- tradeoffs:
${tradeoffs}
- validation warnings:
${warnings}

Produce a TechSpec for this project. Copy the stack fields verbatim from the decision above. Synthesize project.type, project.description, and rationale from the answers + decision.`;
}

function formatAnswerValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}
