import type { BugContext, Hypothesis, RootCauseAnalysis } from '@spex/schemas';
import { RootCauseAnalysisSchema } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/provider.js';
import {
  ROOT_CAUSE_SYSTEM_PROMPT,
  buildRootCauseUserPrompt,
  formatBugContextForPrompt,
} from './prompts.js';
import { analyzeRootCause } from './root-cause-analyzer.js';

const bugContext: BugContext = {
  description: 'Pagination resets to page 1 on filter change.',
  affectedFiles: ['src/components/pagination.tsx', 'src/app/users/page.tsx'],
  recentCommits: [
    {
      sha: 'a1b2c3d4e5f6789012345678901234567890abcd',
      message: 'feat(users): add filtering',
      date: '2026-05-17T11:00:00Z',
    },
  ],
  affectedFileContents: {
    'src/app/users/page.tsx':
      'export default function UsersPage({ filter }) {\n  return <Users key={filter} />;\n}\n',
  },
};

const hypothesis: Hypothesis = {
  id: 'h1',
  description: 'Filter change passes a new key to the Users subtree, forcing it to remount.',
  confidence: 'high',
  evidence: ['UsersPage at src/app/users/page.tsx passes `key={filter}` to <Users />'],
  proposedDiagnostic: 'Inspect <Users /> usage in users/page.tsx for a `key` prop tied to filter.',
};

const confirmedAnalysis: RootCauseAnalysis = {
  confirmed: true,
  rootCause:
    'UsersPage passes the filter value as the React `key` of <Users />. Each filter change remounts the subtree and discards local pagination state.',
  evidence: [
    {
      file: 'src/app/users/page.tsx',
      lines: '2',
      explanation: '`<Users key={filter} />` — React remounts when key changes.',
    },
  ],
};

describe('ROOT_CAUSE_SYSTEM_PROMPT', () => {
  it('requires citing supplied file lines', () => {
    expect(ROOT_CAUSE_SYSTEM_PROMPT).toContain('Cite specific lines');
    expect(ROOT_CAUSE_SYSTEM_PROMPT).toContain('Do not invent file paths');
  });

  it('requires nextHypothesisToTest when refuted', () => {
    expect(ROOT_CAUSE_SYSTEM_PROMPT).toContain('nextHypothesisToTest');
    expect(ROOT_CAUSE_SYSTEM_PROMPT).toContain('refuted analysis is invalid');
  });

  it('asks for either confirm or refute with a structured rootCause', () => {
    expect(ROOT_CAUSE_SYSTEM_PROMPT).toContain('confirmed=true');
    expect(ROOT_CAUSE_SYSTEM_PROMPT).toContain('confirmed=false');
    expect(ROOT_CAUSE_SYSTEM_PROMPT).toContain('Hypothesis <id> rejected');
  });
});

describe('buildRootCauseUserPrompt', () => {
  it('embeds the bug context AND the hypothesis details', () => {
    const prompt = buildRootCauseUserPrompt({ bugContext, hypothesis });
    expect(prompt).toContain('Pagination resets to page 1');
    expect(prompt).toContain('=== src/app/users/page.tsx ===');
    expect(prompt).toContain('id: h1');
    expect(prompt).toContain('confidence: high');
    expect(prompt).toContain('Filter change passes a new key');
    expect(prompt).toContain('previously cited evidence');
    expect(prompt).toContain('UsersPage at src/app/users/page.tsx passes');
    expect(prompt).toContain('Cite specific line ranges');
  });

  it('reuses formatBugContextForPrompt verbatim', () => {
    const prompt = buildRootCauseUserPrompt({ bugContext, hypothesis });
    expect(prompt).toContain(formatBugContextForPrompt(bugContext));
  });
});

describe('analyzeRootCause', () => {
  it('forwards the system prompt and RootCauseAnalysisSchema to the LLM', async () => {
    const generate = vi.fn().mockResolvedValue(confirmedAnalysis);
    const llm: LLMProvider = { generateStructured: generate };

    const result = await analyzeRootCause({ llm, bugContext, hypothesis });
    expect(result).toEqual(confirmedAnalysis);

    const call = generate.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.systemPrompt).toBe(ROOT_CAUSE_SYSTEM_PROMPT);
    expect(call.schema).toBe(RootCauseAnalysisSchema);
  });

  it('embeds the hypothesis in the user prompt', async () => {
    const generate = vi.fn().mockResolvedValue(confirmedAnalysis);
    const llm: LLMProvider = { generateStructured: generate };

    await analyzeRootCause({ llm, bugContext, hypothesis });
    const userPrompt: string = generate.mock.calls[0]?.[0].userPrompt;
    expect(userPrompt).toContain('id: h1');
    expect(userPrompt).toContain('UsersPage at src/app/users/page.tsx');
  });

  it('propagates errors from the LLM provider', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockRejectedValue(new Error('llm down')),
    };
    await expect(analyzeRootCause({ llm, bugContext, hypothesis })).rejects.toThrow('llm down');
  });
});
