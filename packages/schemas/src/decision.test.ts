import { describe, expect, it } from 'vitest';
import { DecisionListSchema, DecisionSchema, ProposalStateSchema } from './decision.js';

describe('DecisionSchema', () => {
  const baseDecision = {
    id: 'project-type',
    order: 1,
    category: 'project',
    question: 'What kind of project is this?',
    proposal: 'A SaaS web app',
    rationale: 'The discovery answers point at a multi-tenant browser-based app.',
    techSpecPath: 'project.type',
    confidence: 'high' as const,
    status: 'pending' as const,
  };

  it('accepts a minimal pending decision', () => {
    expect(DecisionSchema.parse(baseDecision)).toMatchObject({ id: 'project-type' });
  });

  it('rejects an id with uppercase or invalid characters', () => {
    expect(() => DecisionSchema.parse({ ...baseDecision, id: 'Project Type' })).toThrow();
    expect(() => DecisionSchema.parse({ ...baseDecision, id: 'PROJECT_TYPE' })).toThrow();
  });

  it('rejects an empty proposal', () => {
    expect(() => DecisionSchema.parse({ ...baseDecision, proposal: '' })).toThrow();
  });

  it('accepts optional alternatives + resolvedValue + userNote', () => {
    const parsed = DecisionSchema.parse({
      ...baseDecision,
      alternatives: [{ label: 'CLI tool', tradeoffs: 'no browser access' }],
      status: 'modified',
      resolvedValue: 'A CLI tool',
      userNote: 'changed mind — want CLI for now',
    });
    expect(parsed.status).toBe('modified');
    expect(parsed.alternatives).toHaveLength(1);
  });

  it('enforces order >= 1 and integer', () => {
    expect(() => DecisionSchema.parse({ ...baseDecision, order: 0 })).toThrow();
    expect(() => DecisionSchema.parse({ ...baseDecision, order: 1.5 })).toThrow();
  });

  it('rejects unknown status', () => {
    expect(() => DecisionSchema.parse({ ...baseDecision, status: 'maybe' })).toThrow();
  });
});

describe('DecisionListSchema', () => {
  it('requires at least one decision', () => {
    expect(() => DecisionListSchema.parse({ decisions: [] })).toThrow();
  });
});

describe('ProposalStateSchema', () => {
  it('accepts an empty in-progress proposal', () => {
    const parsed = ProposalStateSchema.parse({
      version: 1,
      pausedAt: '2026-05-20T10:00:00.000Z',
      projectName: 'demo',
      decisions: [],
      currentIndex: 0,
    });
    expect(parsed.version).toBe(1);
    expect(parsed.currentIndex).toBe(0);
  });

  it('rejects negative currentIndex', () => {
    expect(() =>
      ProposalStateSchema.parse({
        version: 1,
        pausedAt: '2026-05-20T10:00:00.000Z',
        projectName: 'demo',
        decisions: [],
        currentIndex: -1,
      }),
    ).toThrow();
  });
});
