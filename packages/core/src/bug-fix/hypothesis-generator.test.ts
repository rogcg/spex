import { type BugContext, type HypothesisList, HypothesisListSchema } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/provider.js';
import { generateHypotheses } from './hypothesis-generator.js';
import { HYPOTHESIS_SYSTEM_PROMPT } from './prompts.js';

const bugContext: BugContext = {
  description: 'Pagination resets on filter change.',
  affectedFiles: ['src/components/pagination.tsx'],
  recentCommits: [
    {
      sha: 'a1b2c3d4e5f6789012345678901234567890abcd',
      message: 'feat(users): add filtering',
      date: '2026-05-17T11:00:00Z',
    },
  ],
};

const sample: HypothesisList = {
  hypotheses: [
    {
      id: 'h1',
      description: 'Filtering re-creates the Pagination component, resetting its local state.',
      confidence: 'high',
      evidence: [
        'src/components/pagination.tsx uses useState for currentPage',
        'commit a1b2c3d added a new key= prop that changes on filter',
      ],
      proposedDiagnostic: 'Add a console.log in Pagination useEffect and toggle a filter.',
    },
    {
      id: 'h2',
      description: 'The page query param is read but never written when filters change.',
      confidence: 'medium',
      evidence: ['router.replace is not called after setFilter in users/page.tsx'],
      proposedDiagnostic: 'Search for setFilter callers and inspect router usage.',
    },
    {
      id: 'h3',
      description: 'Server-side render returns page=1 regardless of cookie state.',
      confidence: 'low',
      evidence: ['SSR pathway is unchanged in the recent commits'],
      proposedDiagnostic: 'Disable JS and reload to inspect server output for page=2.',
    },
  ],
};

describe('generateHypotheses', () => {
  it('forwards the system prompt and HypothesisListSchema to the LLM', async () => {
    const generate = vi.fn().mockResolvedValue(sample);
    const llm: LLMProvider = { generateStructured: generate };

    const result = await generateHypotheses({ llm, bugContext });
    expect(result).toEqual(sample);

    const call = generate.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.systemPrompt).toBe(HYPOTHESIS_SYSTEM_PROMPT);
    expect(call.schema).toBe(HypothesisListSchema);
  });

  it('embeds the bug description and affected files in the user prompt', async () => {
    const generate = vi.fn().mockResolvedValue(sample);
    const llm: LLMProvider = { generateStructured: generate };

    await generateHypotheses({ llm, bugContext });
    const userPrompt: string = generate.mock.calls[0]?.[0].userPrompt;
    expect(userPrompt).toContain('Pagination resets on filter change.');
    expect(userPrompt).toContain('- src/components/pagination.tsx');
    expect(userPrompt).toContain('Produce 3-5 ranked hypotheses');
  });

  it('propagates errors from the LLM provider', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockRejectedValue(new Error('llm down')),
    };
    await expect(generateHypotheses({ llm, bugContext })).rejects.toThrow('llm down');
  });
});
