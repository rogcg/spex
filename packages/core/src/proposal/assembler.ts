import { type Decision, type StackDecision, type TechSpec, TechSpecSchema } from '@spex/schemas';
import type { DiscoveryAnswers } from '../discovery/questions.js';
import { SpexError } from '../errors.js';

export interface AssembleTechSpecOptions {
  projectName: string;
  answers: DiscoveryAnswers;
  stackDecision: StackDecision;
  decisions: readonly Decision[];
}

/**
 * Build a TechSpec from a fully-resolved decision list. Each decision's
 * `resolvedValue` (or `proposal`, if accepted unchanged) is mapped to the
 * TechSpec field indicated by its `techSpecPath`. Stack-derived fields fall
 * back to the committed stack decision when no decision targeted them.
 */
export function assembleTechSpec(opts: AssembleTechSpecOptions): TechSpec {
  const { projectName, answers, stackDecision, decisions } = opts;

  ensureAllResolved(decisions);
  const map = indexByPath(decisions);

  const projectType = resolvedString(map.get('project.type')) ?? 'application';
  const projectDescription =
    resolvedString(map.get('project.description')) ?? `${projectName} (auto-described)`;

  const primaryUsers =
    resolvedString(map.get('context.primary_users')) ?? answerAsString(answers, 'primary_users');
  const expectedScale =
    resolvedString(map.get('context.expected_scale')) ?? answerAsString(answers, 'expected_scale');
  const authRequirements =
    resolvedString(map.get('context.auth_requirements')) ??
    answerAsString(answers, 'auth_requirements');
  const dataPersistence =
    resolvedString(map.get('context.data_persistence')) ??
    answerAsString(answers, 'data_persistence');

  const stackLabel = resolvedString(map.get('stack.label')) ?? stackDecision.label;
  const stackTradeoffs = resolvedList(map.get('stack.tradeoffs')) ?? stackDecision.tradeoffs;
  const stackWarnings =
    resolvedList(map.get('stack.validation_warnings')) ?? stackDecision.validationWarnings;

  const componentRationaleOverrides = mapComponentRationale(decisions);
  const components = stackDecision.components.map((c, idx) => {
    const override = componentRationaleOverrides.get(idx);
    return override ? { ...c, rationale: override } : c;
  });

  const overallRationale = resolvedString(map.get('rationale')) ?? stackDecision.rationale;
  if (overallRationale.length < 50) {
    throw new SpexError(
      'Assembled TechSpec rationale is shorter than 50 characters; review the decision targeting "rationale".',
    );
  }

  const spec: TechSpec = {
    version: 1,
    project: {
      name: projectName,
      type: projectType,
      description: projectDescription,
    },
    context: {
      primary_users: primaryUsers,
      expected_scale: expectedScale,
      auth_requirements: authRequirements,
      data_persistence: dataPersistence,
    },
    stack: {
      label: stackLabel,
      source: stackDecision.source,
      components,
      tradeoffs: stackTradeoffs,
      validation_warnings: stackWarnings,
    },
    rationale: overallRationale,
  };

  return TechSpecSchema.parse(spec);
}

function ensureAllResolved(decisions: readonly Decision[]): void {
  for (const d of decisions) {
    if (d.status !== 'accepted' && d.status !== 'modified') {
      throw new SpexError(
        `Cannot assemble tech-spec: decision "${d.id}" has status "${d.status}". All decisions must be accepted or modified.`,
      );
    }
  }
}

function indexByPath(decisions: readonly Decision[]): Map<string, Decision> {
  const map = new Map<string, Decision>();
  for (const d of decisions) {
    if (d.techSpecPath === 'stack.component_rationale') continue;
    map.set(d.techSpecPath, d);
  }
  return map;
}

/**
 * Map per-component rationale decisions to their (0-based) component index by
 * order of appearance. Decisions targeting `stack.component_rationale` are
 * paired with stack components in the order they appear in the decision list.
 */
function mapComponentRationale(decisions: readonly Decision[]): Map<number, string> {
  const map = new Map<number, string>();
  let idx = 0;
  for (const d of decisions) {
    if (d.techSpecPath !== 'stack.component_rationale') continue;
    const value = resolvedString(d);
    if (value) map.set(idx, value);
    idx += 1;
  }
  return map;
}

function resolvedString(decision: Decision | undefined): string | undefined {
  if (!decision) return undefined;
  return decision.resolvedValue ?? decision.proposal;
}

function resolvedList(decision: Decision | undefined): string[] | undefined {
  const value = resolvedString(decision);
  if (value === undefined) return undefined;
  return value
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function answerAsString(answers: DiscoveryAnswers, key: string): string {
  const value = answers[key];
  if (value === undefined) return 'unspecified';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}
