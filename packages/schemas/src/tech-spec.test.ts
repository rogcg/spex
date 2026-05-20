import { describe, expect, it } from 'vitest';
import { TechSpecSchema } from './tech-spec.js';

const validSpec = {
  version: 1,
  project: {
    name: 'my-saas',
    type: 'web-application',
    description: 'A SaaS app for tracking habits',
  },
  context: {
    primary_users: 'Consumers (B2C)',
    expected_scale: '100-1000 users',
    auth_requirements: 'OAuth (Google, GitHub, etc.)',
    data_persistence: 'Relational database',
  },
  stack: {
    label: 'Next.js + Postgres + Drizzle',
    source: 'recommended' as const,
    components: [
      { role: 'framework', choice: 'Next.js 15 App Router', rationale: 'SSR web app' },
      { role: 'database', choice: 'Postgres', rationale: 'Relational persistence' },
      { role: 'orm', choice: 'Drizzle', rationale: 'Type-safe SQL' },
    ],
    tradeoffs: ['Vendor coupling to Vercel'],
    validation_warnings: [],
  },
  rationale:
    'Chose Next.js with App Router for first-class TypeScript support, server components, and a strong DX for SaaS applications.',
};

describe('TechSpecSchema', () => {
  it('accepts a valid tech spec with a generic stack section', () => {
    const result = TechSpecSchema.safeParse(validSpec);
    expect(result.success).toBe(true);
  });

  it('rejects when version is not literal 1', () => {
    const result = TechSpecSchema.safeParse({ ...validSpec, version: 2 });
    expect(result.success).toBe(false);
  });

  it('rejects when project.name is empty', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      project: { ...validSpec.project, name: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects when stack.label is empty', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      stack: { ...validSpec.stack, label: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects when stack.source is not one of the allowed values', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      stack: { ...validSpec.stack, source: 'guessed' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects when stack has no components', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      stack: { ...validSpec.stack, components: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects when a stack component is missing a rationale', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      stack: {
        ...validSpec.stack,
        components: [{ role: 'framework', choice: 'Next.js' }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts any framework — no fixed catalog', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      stack: {
        ...validSpec.stack,
        label: 'SvelteKit + Drizzle + Turso',
        components: [
          { role: 'framework', choice: 'SvelteKit', rationale: 'Lightweight web stack' },
          { role: 'database', choice: 'Turso (libSQL)', rationale: 'Edge SQLite' },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when rationale is shorter than 50 characters', () => {
    const result = TechSpecSchema.safeParse({ ...validSpec, rationale: 'too short' });
    expect(result.success).toBe(false);
  });

  it('rejects when a required context field is missing', () => {
    const { primary_users: _omit, ...partialContext } = validSpec.context;
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      context: partialContext,
    });
    expect(result.success).toBe(false);
  });

  it('accepts an inference block flagging inferred fields', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      inference: {
        inferred: true,
        inferred_fields: ['stack.components[0].version'],
        notes: 'Detected from package.json',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an inference block with no inferred_fields', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      inference: {
        inferred: true,
        inferred_fields: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an inference block where inferred is not literal true', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      inference: {
        inferred: false,
        inferred_fields: ['stack.components[0].version'],
      },
    });
    expect(result.success).toBe(false);
  });
});
