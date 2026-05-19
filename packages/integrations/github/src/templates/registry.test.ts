import { describe, expect, it } from 'vitest';
import {
  UnknownWorkflowTemplateError,
  WORKFLOW_TEMPLATES,
  getWorkflowTemplate,
  listWorkflowTemplates,
} from './registry.js';

describe('WORKFLOW_TEMPLATES', () => {
  it('advertises all workflow templates by name', () => {
    const names = listWorkflowTemplates().map((t) => t.name);
    expect(names).toEqual(['pr-review', 'implement-from-issue', 'linear-sync']);
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
    // implement-from-issue runs `spex implement` which checks for a clean
    // working tree; .spex-source/ must be excluded so the check passes.
    expect(tpl.content).toContain('.spex-source/');
    expect(tpl.content).toContain('.git/info/exclude');
  });

  it('returns the linear-sync template with valid-looking content', async () => {
    const tpl = await getWorkflowTemplate('linear-sync');
    expect(tpl.name).toBe('linear-sync');
    expect(tpl.filename).toBe('linear-sync.yml');
    expect(tpl.content).toContain('name: SPEX Linear Sync');
    expect(tpl.content).toContain('pull_request');
    expect(tpl.content).toContain('spex linear-sync');
    expect(tpl.content).toContain('LINEAR_API_KEY');
    expect(tpl.content).toContain('SPEX_REPO: rogcg/spex');
    expect(tpl.content).toContain('SPEX_REF: main');
    expect(tpl.content).toContain('--event-path');
  });

  it('throws UnknownWorkflowTemplateError for an unknown name', async () => {
    await expect(getWorkflowTemplate('nope')).rejects.toBeInstanceOf(UnknownWorkflowTemplateError);
  });
});
