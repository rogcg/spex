import type { StackDecision } from '@spex/schemas';
import type { DiscoveryAnswers } from '../discovery/questions.js';

export const PROPOSAL_DECISIONS_SYSTEM_PROMPT = `You are SPEX, breaking a tech-spec into a sequence of small, individually-approvable decisions for an iterative gate flow.

You receive:
- the project name
- the user's discovery answers
- the committed stack decision (already approved during stack selection)

Your job is to emit an ordered list of decisions that, taken together, fully populate a TechSpec. Each decision presents a single proposed value for a specific tech-spec field with rationale and confidence. The user will accept, reject, debate, or explore alternatives for each.

Rules:
- Emit between 10 and 14 decisions, ordered logically (project identity first, then context, then stack-derived rationale, then overall rationale).
- Each decision MUST have:
  - id: short kebab-case slug (e.g. "project-type", "context-primary-users", "rationale-overall")
  - order: 1-based position in the list
  - category: one of "project", "context", "stack", "rationale"
  - question: the question being decided (1 sentence)
  - proposal: the concrete proposed value (the string that will land in tech-spec.yaml)
  - rationale: why this value (1-3 sentences, grounded in the discovery + stack)
  - techSpecPath: the dotted path of the TechSpec field this decision fills, exactly one of:
      project.type, project.description,
      context.primary_users, context.expected_scale,
      context.auth_requirements, context.data_persistence,
      stack.label, stack.tradeoffs, stack.validation_warnings,
      stack.component_rationale (one decision per stack component is allowed),
      rationale
  - confidence: "high" | "medium" | "low" — be honest. "low" means the discovery answers are ambiguous; "medium" means a judgement call; "high" means directly grounded in the answers or the stack.
  - status: always "pending" at emission time

Constraints:
- Re-affirm context fields verbatim from the discovery answers (proposal = the user's answer); set their confidence to "high".
- Reaffirm stack.label, stack.tradeoffs, stack.validation_warnings from the committed stack decision.
- For stack.component_rationale decisions, set proposal to a 1-sentence per-component justification (one decision per component).
- The overall rationale (category=rationale, techSpecPath=rationale) MUST be at least 60 characters.
- Do NOT propose alternative stacks — the stack is already decided.
- Do NOT include alternatives in the initial list. Alternatives are generated on demand when the user picks "explore".`;

export function buildProposalDecisionsUserPrompt(opts: {
  projectName: string;
  answers: DiscoveryAnswers;
  decision: StackDecision;
}): string {
  const { projectName, answers, decision } = opts;
  const formatted = Object.entries(answers)
    .map(([key, value]) => `- ${key}: ${formatAnswerValue(value)}`)
    .join('\n');

  const components = decision.components
    .map((c, i) => `  ${i + 1}. ${c.role}: ${c.choice} — ${c.rationale}`)
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

Emit the ordered decision list now.`;
}

export const DECISION_REVISION_SYSTEM_PROMPT = `You are SPEX, revising a previously proposed tech-spec decision in light of user feedback.

You receive the original decision and the user's reason for rejecting it. Produce a single revised decision that addresses the feedback.

Rules:
- Keep id, order, category, techSpecPath, and question identical to the original.
- Update proposal and rationale to reflect the feedback.
- Set status to "modified".
- Set confidence honestly (revision usually drops confidence one level).
- Do not include alternatives.`;

export function buildDecisionRevisionUserPrompt(opts: {
  decision: {
    id: string;
    order: number;
    category: string;
    question: string;
    techSpecPath: string;
    proposal: string;
    rationale: string;
    confidence: string;
  };
  feedback: string;
}): string {
  const d = opts.decision;
  return `Original decision:
- id: ${d.id}
- order: ${d.order}
- category: ${d.category}
- question: ${d.question}
- techSpecPath: ${d.techSpecPath}
- proposal: ${d.proposal}
- rationale: ${d.rationale}
- confidence: ${d.confidence}

User feedback (reason for rejecting the proposal):
${opts.feedback}

Produce a revised decision now.`;
}

export const DECISION_ALTERNATIVES_SYSTEM_PROMPT = `You are SPEX, generating concrete alternatives to a previously proposed tech-spec decision so the user can compare and pick.

Produce 2-3 alternatives. Each alternative has:
- label: short name (1-5 words)
- tradeoffs: 1-2 sentences describing why this alternative beats / loses against the original proposal

Constraints:
- Alternatives must address the SAME question and tech-spec path as the original.
- Do not repeat the original proposal verbatim.
- Be concrete: do not produce vague "consider X" suggestions.`;

export function buildDecisionAlternativesUserPrompt(opts: {
  decision: {
    id: string;
    question: string;
    techSpecPath: string;
    proposal: string;
    rationale: string;
  };
}): string {
  const d = opts.decision;
  return `Decision under exploration:
- id: ${d.id}
- question: ${d.question}
- techSpecPath: ${d.techSpecPath}
- current proposal: ${d.proposal}
- current rationale: ${d.rationale}

Generate 2-3 alternatives now.`;
}

export const DECISION_DEBATE_SYSTEM_PROMPT = `You are SPEX, defending or refining a previously proposed tech-spec decision in light of a user concern.

You receive the original decision and the user's concern. Produce a focused response (3-6 sentences) that either:
- defends the proposal with concrete reasoning, OR
- acknowledges the concern and refines the proposal inline.

Do not generate an entire revised decision — just argue or refine via prose. The user will decide afterwards whether to accept, reject, or explore.`;

export function buildDecisionDebateUserPrompt(opts: {
  decision: {
    id: string;
    question: string;
    techSpecPath: string;
    proposal: string;
    rationale: string;
  };
  concern: string;
}): string {
  const d = opts.decision;
  return `Decision under debate:
- id: ${d.id}
- question: ${d.question}
- techSpecPath: ${d.techSpecPath}
- proposal: ${d.proposal}
- rationale: ${d.rationale}

User concern:
${opts.concern}

Respond now (no preamble, no markdown).`;
}

function formatAnswerValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}
