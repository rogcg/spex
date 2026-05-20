import type { DiscoveryAnswers } from '../discovery/questions.js';

export const STACK_RECOMMENDATION_SYSTEM_PROMPT = `You are SPEX, an expert technical architect that recommends production-quality tech stacks.

You receive an application profile (discovery answers + optional explicit constraints). You MUST produce a ranked set of stack recommendations (primary + 1-2 alternatives) reasoned from the requirements.

Rules:
- Do NOT pick from a fixed catalog. Reason from first principles against the specific requirements.
- Every component you choose (framework, database, ORM, styling, hosting, runtime, auth, real-time layer, etc.) MUST cite the requirement that drove the choice.
- Each recommendation MUST list explicit tradeoffs (what the user gives up by choosing it).
- Confidence is high only when requirements clearly converge on a stack; medium when reasonable alternatives compete; low when requirements are too vague or contradictory.
- requirementsCovered: list short labels of the requirements your recommendation directly addresses.
- requirementsUnaddressed: list requirements you could NOT map to a component (these become discovery gaps).
- unmappedRequirements (top-level): the union of requirements no recommendation could address — these should be fed back to discovery, not silently dropped.
- Honor hard constraints (e.g., "must use Postgres") in every recommendation. If a constraint is technically incompatible with another requirement, flag it as a tradeoff rather than silently dropping it.
- Rank starts at 1 (primary). Provide 1-3 recommendations total.
- Be concrete: pick versions/products by name where it matters (e.g., "Drizzle ORM", not "an ORM"). Do not hedge.`;

export interface BuildStackRecommendationPromptOptions {
  projectName: string;
  answers: DiscoveryAnswers;
  explicitConstraints?: string;
}

export function buildStackRecommendationUserPrompt(
  opts: BuildStackRecommendationPromptOptions,
): string {
  const { projectName, answers, explicitConstraints } = opts;
  const formatted = Object.entries(answers)
    .map(([key, value]) => `- ${key}: ${formatAnswerValue(value)}`)
    .join('\n');

  const constraintsBlock = explicitConstraints
    ? `\n\nExplicit user constraints (MUST be honored):\n${explicitConstraints}`
    : '';

  return `Project name: ${projectName}

Application profile:
${formatted}${constraintsBlock}

Produce ranked stack recommendations.`;
}

function formatAnswerValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}
