import type { StackDecision } from '@spex/schemas';
import { describe, expect, it } from 'vitest';
import { TECH_SPEC_SYSTEM_PROMPT, buildTechSpecUserPrompt } from './prompts.js';

const sampleDecision: StackDecision = {
  label: 'Next.js + Postgres + Drizzle',
  source: 'recommended',
  components: [
    { role: 'framework', choice: 'Next.js 15', rationale: 'SSR' },
    { role: 'database', choice: 'Postgres', rationale: 'Relational' },
  ],
  rationale: 'Best fit.',
  tradeoffs: ['Vendor coupling'],
  validationWarnings: [],
};

describe('buildTechSpecUserPrompt', () => {
  it('includes the project name on its own line', () => {
    const prompt = buildTechSpecUserPrompt({
      projectName: 'my-saas',
      answers: { foo: 'bar' },
      decision: sampleDecision,
    });
    expect(prompt).toContain('Project name: my-saas');
  });

  it('lists every answer as a "- key: value" bullet', () => {
    const prompt = buildTechSpecUserPrompt({
      projectName: 'x',
      answers: { foo: 'bar', baz: 'qux' },
      decision: sampleDecision,
    });
    expect(prompt).toContain('- foo: bar');
    expect(prompt).toContain('- baz: qux');
  });

  it('preserves answer insertion order', () => {
    const prompt = buildTechSpecUserPrompt({
      projectName: 'x',
      answers: { a: '1', b: '2', c: '3' },
      decision: sampleDecision,
    });
    const idxA = prompt.indexOf('- a: 1');
    const idxB = prompt.indexOf('- b: 2');
    const idxC = prompt.indexOf('- c: 3');
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
  });

  it('handles an empty answers map without throwing', () => {
    const prompt = buildTechSpecUserPrompt({
      projectName: 'x',
      answers: {},
      decision: sampleDecision,
    });
    expect(prompt).toContain('Project name: x');
    expect(prompt).toContain('Discovery answers:');
  });

  it('serializes the committed stack decision', () => {
    const prompt = buildTechSpecUserPrompt({
      projectName: 'x',
      answers: {},
      decision: sampleDecision,
    });
    expect(prompt).toContain('label: Next.js + Postgres + Drizzle');
    expect(prompt).toContain('source: recommended');
    expect(prompt).toContain('framework: Next.js 15');
    expect(prompt).toContain('Vendor coupling');
  });

  it('marks empty tradeoffs and warnings explicitly', () => {
    const prompt = buildTechSpecUserPrompt({
      projectName: 'x',
      answers: {},
      decision: { ...sampleDecision, tradeoffs: [], validationWarnings: [] },
    });
    expect(prompt).toContain('tradeoffs:\n  (none)');
    expect(prompt).toContain('validation warnings:\n  (none)');
  });

  it('formats array and boolean answer values', () => {
    const prompt = buildTechSpecUserPrompt({
      projectName: 'x',
      answers: { tags: ['a', 'b'], live: true, dead: false },
      decision: sampleDecision,
    });
    expect(prompt).toContain('- tags: a, b');
    expect(prompt).toContain('- live: yes');
    expect(prompt).toContain('- dead: no');
  });
});

describe('TECH_SPEC_SYSTEM_PROMPT', () => {
  it('describes its role as packaging a committed stack decision', () => {
    expect(TECH_SPEC_SYSTEM_PROMPT).toMatch(/committed stack decision/i);
    expect(TECH_SPEC_SYSTEM_PROMPT).toMatch(/StackDecision/);
  });

  it('forbids re-deciding the stack here', () => {
    expect(TECH_SPEC_SYSTEM_PROMPT).toMatch(/stack is already decided/i);
  });

  it('requires version literal 1', () => {
    expect(TECH_SPEC_SYSTEM_PROMPT).toMatch(/version to 1/);
  });
});
