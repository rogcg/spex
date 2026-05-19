import { describe, expect, it } from 'vitest';
import {
  UnknownWorkflowTemplateError,
  WORKFLOW_TEMPLATES,
  getWorkflowTemplate,
  listWorkflowTemplates,
} from './registry.js';

describe('WORKFLOW_TEMPLATES', () => {
  it('advertises both workflow templates by name', () => {
    const names = listWorkflowTemplates().map((t) => t.name);
    expect(names).toEqual(['pr-review', 'implement-from-issue']);
  });

  it('each template has a non-empty description', () => {
    for (const tpl of WORKFLOW_TEMPLATES) {
      expect(tpl.description.length).toBeGreaterThan(0);
    }
  });
});

describe('getWorkflowTemplate', () => {
  it('returns the pr-review template with valid-looking content', async () => {
    const tpl = await getWorkflowTemplate('pr-review');
    expect(tpl.name).toBe('pr-review');
    expect(tpl.filename).toBe('pr-review.yml');
    expect(tpl.content).toContain('name: SPEX Review');
    expect(tpl.content).toContain('runs-on: ubuntu-latest');
    expect(tpl.content).toContain('spex review');
    expect(tpl.content).toContain('GITHUB_TOKEN');
    expect(tpl.content).toContain('ANTHROPIC_API_KEY');
    // Installs SPEX from the public GitHub repo (not npm — see SPX-46 / release sprint).
    expect(tpl.content).toContain('SPEX_REPO: rogcg/spex');
    expect(tpl.content).toContain('SPEX_REF: main');
    expect(tpl.content).toContain('pnpm/action-setup@v4');
    expect(tpl.content).toContain('pnpm install --frozen-lockfile');
    expect(tpl.content).toContain('pnpm -r build');
    expect(tpl.content).toContain('packages/cli/dist/index.js');
  });

  it('returns the implement-from-issue template with valid-looking content', async () => {
    const tpl = await getWorkflowTemplate('implement-from-issue');
    expect(tpl.name).toBe('implement-from-issue');
    expect(tpl.filename).toBe('implement-from-issue.yml');
    expect(tpl.content).toContain('name: SPEX Implement from Issue');
    expect(tpl.content).toContain("github.event.label.name == 'spex:implement'");
    expect(tpl.content).toContain('spex implement');
    expect(tpl.content).toContain('GITHUB_TOKEN');
    expect(tpl.content).toContain('ANTHROPIC_API_KEY');
    // Installs SPEX from the public GitHub repo (not npm — see SPX-46 / release sprint).
    expect(tpl.content).toContain('SPEX_REPO: rogcg/spex');
    expect(tpl.content).toContain('SPEX_REF: main');
    expect(tpl.content).toContain('pnpm/action-setup@v4');
    expect(tpl.content).toContain('pnpm install --frozen-lockfile');
    expect(tpl.content).toContain('pnpm -r build');
    expect(tpl.content).toContain('packages/cli/dist/index.js');
  });

  it('throws UnknownWorkflowTemplateError for an unknown name', async () => {
    await expect(getWorkflowTemplate('nope')).rejects.toBeInstanceOf(UnknownWorkflowTemplateError);
  });
});
