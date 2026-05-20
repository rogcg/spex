import { type TechSpec, TechSpecSchema } from '@spex/schemas';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { techSpecToYaml } from './writer.js';

const validSpec: TechSpec = {
  version: 1,
  project: {
    name: 'demo',
    type: 'web-app',
    description: 'A demo project',
  },
  context: {
    primary_users: 'Developers',
    expected_scale: 'Less than 100 users',
    auth_requirements: 'None',
    data_persistence: 'Simple key-value',
  },
  stack: {
    label: 'Next.js + Tailwind',
    source: 'recommended',
    components: [
      { role: 'framework', choice: 'Next.js 15 App Router', rationale: 'Full-stack web app' },
      { role: 'styling', choice: 'Tailwind CSS', rationale: 'Rapid prototyping' },
    ],
    tradeoffs: ['Vercel coupling for previews'],
    validation_warnings: [],
  },
  rationale:
    'Next.js with App Router gives us streaming SSR and a strong DX for this developer-facing tool.',
};

describe('techSpecToYaml', () => {
  it('produces YAML that round-trips back to the same TechSpec via the schema', () => {
    const yaml = techSpecToYaml(validSpec);
    const parsed = parseYaml(yaml);
    const result = TechSpecSchema.parse(parsed);
    expect(result).toEqual(validSpec);
  });

  it('emits every top-level key in the schema', () => {
    const yaml = techSpecToYaml(validSpec);
    expect(yaml).toMatch(/^version: 1$/m);
    expect(yaml).toMatch(/^project:/m);
    expect(yaml).toMatch(/^context:/m);
    expect(yaml).toMatch(/^stack:/m);
    expect(yaml).toMatch(/^rationale:/m);
  });

  it('preserves long strings on a single line (lineWidth: 0)', () => {
    const yaml = techSpecToYaml({
      ...validSpec,
      rationale:
        'A long single-line rationale that should not be folded across multiple YAML lines even when it exceeds the default line width threshold.',
    });
    expect(yaml).toContain(
      'A long single-line rationale that should not be folded across multiple YAML lines even when it exceeds the default line width threshold.',
    );
  });
});
