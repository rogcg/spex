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
    language: 'typescript',
    frontend: {
      framework: 'nextjs',
      version: '15',
      styling: 'tailwindcss',
      app_router: true,
    },
  },
  scaffolding_plan: {
    commands: ['pnpm create next-app@latest my-saas --typescript --tailwind --app --src-dir'],
  },
  rationale:
    'Chose Next.js with App Router for first-class TypeScript support, server components, and a strong DX for SaaS applications.',
};

describe('TechSpecSchema', () => {
  it('accepts a valid tech spec', () => {
    const result = TechSpecSchema.safeParse(validSpec);
    expect(result.success).toBe(true);
  });

  it('accepts an optional post_install_files field', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      scaffolding_plan: {
        commands: validSpec.scaffolding_plan.commands,
        post_install_files: ['.ai/tech-spec.yaml', '.ai/README.md'],
      },
    });
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

  it('rejects when stack.language is not "typescript"', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      stack: { ...validSpec.stack, language: 'javascript' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects when stack.frontend.framework is not "nextjs"', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      stack: {
        ...validSpec.stack,
        frontend: { ...validSpec.stack.frontend, framework: 'remix' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects when scaffolding_plan.commands is empty', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      scaffolding_plan: { commands: [] },
    });
    expect(result.success).toBe(false);
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

  it('rejects when stack.frontend.app_router is not a boolean', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      stack: {
        ...validSpec.stack,
        frontend: { ...validSpec.stack.frontend, app_router: 'true' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts an inference block flagging inferred fields', () => {
    const result = TechSpecSchema.safeParse({
      ...validSpec,
      inference: {
        inferred: true,
        inferred_fields: ['stack.frontend.version', 'stack.frontend.styling'],
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
        inferred_fields: ['stack.frontend.version'],
      },
    });
    expect(result.success).toBe(false);
  });
});
