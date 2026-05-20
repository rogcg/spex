import type { Decision, StackDecision } from '@spex/schemas';
import { describe, expect, it } from 'vitest';
import { assembleTechSpec } from './assembler.js';

const stackDecision: StackDecision = {
  label: 'Next.js + Postgres + Drizzle',
  source: 'recommended',
  rationale: 'Selected because the discovery answers point to a SSR-friendly relational SaaS.',
  components: [
    { role: 'framework', choice: 'Next.js', rationale: 'SSR + API routes in one project.' },
    { role: 'database', choice: 'Postgres', rationale: 'Battle-tested relational store.' },
    { role: 'orm', choice: 'Drizzle', rationale: 'Type-safe SQL with low overhead.' },
  ],
  tradeoffs: ['Heavier than a static site'],
  validationWarnings: [],
};

function decision(overrides: Partial<Decision>): Decision {
  return {
    id: 'project-type',
    order: 1,
    category: 'project',
    question: 'What is the project type?',
    proposal: 'SaaS web app',
    rationale: 'The discovery answers describe a multi-tenant browser-based product.',
    techSpecPath: 'project.type',
    confidence: 'high',
    status: 'accepted',
    resolvedValue: 'SaaS web app',
    ...overrides,
  };
}

describe('assembleTechSpec', () => {
  it('builds a TechSpec from a fully accepted decision list', () => {
    const decisions: Decision[] = [
      decision({}),
      decision({
        id: 'project-description',
        order: 2,
        techSpecPath: 'project.description',
        question: 'Describe the product',
        proposal: 'A multi-tenant SaaS with auth and dashboards',
        resolvedValue: 'A multi-tenant SaaS with auth and dashboards',
      }),
      decision({
        id: 'rationale-overall',
        order: 3,
        category: 'rationale',
        techSpecPath: 'rationale',
        question: 'Why this stack fits',
        proposal:
          'Next.js handles the SSR product surface, Postgres + Drizzle covers relational tenant data with strong typing, and the trade-offs are acceptable for the expected scale.',
        resolvedValue:
          'Next.js handles the SSR product surface, Postgres + Drizzle covers relational tenant data with strong typing, and the trade-offs are acceptable for the expected scale.',
      }),
    ];
    const spec = assembleTechSpec({
      projectName: 'acme',
      answers: {
        primary_users: 'internal admins',
        expected_scale: '100 users',
        auth_requirements: 'email/password',
        data_persistence: 'Postgres',
      },
      stackDecision,
      decisions,
    });
    expect(spec.project.name).toBe('acme');
    expect(spec.project.type).toBe('SaaS web app');
    expect(spec.project.description).toContain('multi-tenant');
    expect(spec.context.primary_users).toBe('internal admins');
    expect(spec.stack.label).toBe(stackDecision.label);
    expect(spec.stack.components).toHaveLength(3);
    expect(spec.rationale.length).toBeGreaterThanOrEqual(50);
  });

  it('throws if any decision is not accepted or modified', () => {
    expect(() =>
      assembleTechSpec({
        projectName: 'acme',
        answers: {},
        stackDecision,
        decisions: [decision({ status: 'pending' })],
      }),
    ).toThrow(/status "pending"/);
  });

  it('applies stack component rationale overrides in order', () => {
    const decisions: Decision[] = [
      decision({}),
      decision({
        id: 'rationale-overall',
        order: 2,
        category: 'rationale',
        techSpecPath: 'rationale',
        question: 'Why',
        proposal:
          'Default rationale exceeding fifty characters to satisfy the TechSpec rationale length requirement easily.',
        resolvedValue:
          'Default rationale exceeding fifty characters to satisfy the TechSpec rationale length requirement easily.',
      }),
      decision({
        id: 'component-rationale-0',
        order: 3,
        category: 'stack',
        techSpecPath: 'stack.component_rationale',
        question: 'Why this framework',
        proposal: 'Overridden framework rationale',
        resolvedValue: 'Overridden framework rationale',
      }),
      decision({
        id: 'component-rationale-1',
        order: 4,
        category: 'stack',
        techSpecPath: 'stack.component_rationale',
        question: 'Why this database',
        proposal: 'Overridden database rationale',
        resolvedValue: 'Overridden database rationale',
      }),
    ];
    const spec = assembleTechSpec({
      projectName: 'acme',
      answers: {},
      stackDecision,
      decisions,
    });
    expect(spec.stack.components[0]?.rationale).toBe('Overridden framework rationale');
    expect(spec.stack.components[1]?.rationale).toBe('Overridden database rationale');
    expect(spec.stack.components[2]?.rationale).toBe(stackDecision.components[2]?.rationale);
  });

  it('falls back to stackDecision values when no decision targets them', () => {
    const decisions: Decision[] = [
      decision({
        id: 'rationale-overall',
        category: 'rationale',
        techSpecPath: 'rationale',
        proposal:
          'Solid rationale long enough to satisfy the fifty-character minimum check in TechSpecSchema.',
        resolvedValue:
          'Solid rationale long enough to satisfy the fifty-character minimum check in TechSpecSchema.',
      }),
    ];
    const spec = assembleTechSpec({
      projectName: 'acme',
      answers: {
        primary_users: 'devs',
        expected_scale: '10',
        auth_requirements: 'oauth',
        data_persistence: 'pg',
      },
      stackDecision,
      decisions,
    });
    expect(spec.stack.tradeoffs).toEqual(stackDecision.tradeoffs);
    expect(spec.stack.validation_warnings).toEqual(stackDecision.validationWarnings);
  });
});
