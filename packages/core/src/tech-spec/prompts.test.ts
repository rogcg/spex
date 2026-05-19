import { describe, expect, it } from 'vitest';
import { TECH_SPEC_SYSTEM_PROMPT, buildTechSpecUserPrompt } from './prompts.js';

describe('buildTechSpecUserPrompt', () => {
  it('includes the project name on its own line', () => {
    const prompt = buildTechSpecUserPrompt({
      projectName: 'my-saas',
      answers: { foo: 'bar' },
    });
    expect(prompt).toContain('Project name: my-saas');
  });

  it('lists every answer as a "- key: value" bullet', () => {
    const prompt = buildTechSpecUserPrompt({
      projectName: 'x',
      answers: { foo: 'bar', baz: 'qux' },
    });
    expect(prompt).toContain('- foo: bar');
    expect(prompt).toContain('- baz: qux');
  });

  it('preserves answer insertion order', () => {
    const prompt = buildTechSpecUserPrompt({
      projectName: 'x',
      answers: { a: '1', b: '2', c: '3' },
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
    });
    expect(prompt).toContain('Project name: x');
    expect(prompt).toContain('Discovery answers:');
  });
});

describe('TECH_SPEC_SYSTEM_PROMPT', () => {
  it('locks the stack to TypeScript and Next.js', () => {
    expect(TECH_SPEC_SYSTEM_PROMPT).toMatch(/TypeScript/);
    expect(TECH_SPEC_SYSTEM_PROMPT).toMatch(/Next\.js/);
  });

  it('mandates the pnpm create next-app scaffolding command', () => {
    expect(TECH_SPEC_SYSTEM_PROMPT).toMatch(/pnpm create next-app@latest/);
  });

  it('requires App Router and version literals matching the schema', () => {
    expect(TECH_SPEC_SYSTEM_PROMPT).toMatch(/app_router to true/);
    expect(TECH_SPEC_SYSTEM_PROMPT).toMatch(/version to 1/);
  });
});
