import type { StackRecommendations } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/provider.js';
import { recommendStack } from './recommendation-engine.js';

function fakeProvider(response: StackRecommendations): LLMProvider {
  return {
    generateStructured: vi.fn().mockResolvedValue(response),
  } as unknown as LLMProvider;
}

const crudSaasResponse: StackRecommendations = {
  recommendations: [
    {
      rank: 1,
      label: 'Next.js + Postgres + Drizzle',
      components: [
        { role: 'framework', choice: 'Next.js 15 App Router', rationale: 'Web SaaS with SSR' },
        { role: 'database', choice: 'Postgres', rationale: 'Relational data persistence' },
        { role: 'orm', choice: 'Drizzle', rationale: 'Type-safe SQL with low overhead' },
        { role: 'auth', choice: 'Auth.js', rationale: 'OAuth + email/password' },
        { role: 'hosting', choice: 'Vercel', rationale: 'Native Next.js deployment' },
      ],
      tradeoffs: ['Vendor coupling to Vercel for previews', 'Drizzle migrations are manual'],
      confidence: 'high',
      requirementsCovered: ['web SaaS', 'relational data', 'OAuth'],
      requirementsUnaddressed: [],
    },
    {
      rank: 2,
      label: 'Remix + Postgres + Prisma',
      components: [
        { role: 'framework', choice: 'Remix', rationale: 'Form-first SaaS UX' },
        { role: 'database', choice: 'Postgres', rationale: 'Relational data persistence' },
        { role: 'orm', choice: 'Prisma', rationale: 'Managed migrations, mature client' },
      ],
      tradeoffs: ['Smaller ecosystem than Next.js'],
      confidence: 'medium',
      requirementsCovered: ['web SaaS', 'relational data'],
      requirementsUnaddressed: ['OAuth'],
    },
  ],
  unmappedRequirements: [],
};

describe('recommendStack', () => {
  it('passes system + user prompts and schema to the LLM and returns the recommendations', async () => {
    const llm = fakeProvider(crudSaasResponse);
    const result = await recommendStack({
      llm,
      projectName: 'acme',
      answers: { project_type: 'CRUD SaaS', data_persistence: 'Relational database' },
    });

    expect(result.recommendations).toHaveLength(2);
    expect(result.recommendations[0]?.label).toBe('Next.js + Postgres + Drizzle');
    expect(llm.generateStructured).toHaveBeenCalledOnce();
    const call = (llm.generateStructured as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      systemPrompt: string;
      userPrompt: string;
    };
    expect(call.systemPrompt).toContain('SPEX');
    expect(call.userPrompt).toContain('acme');
    expect(call.userPrompt).toContain('project_type: CRUD SaaS');
  });

  it('includes explicit constraints when provided', async () => {
    const llm = fakeProvider(crudSaasResponse);
    await recommendStack({
      llm,
      projectName: 'acme',
      answers: { project_type: 'CRUD SaaS' },
      explicitConstraints: 'Must use Postgres',
    });
    const call = (llm.generateStructured as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      userPrompt: string;
    };
    expect(call.userPrompt).toContain('Must use Postgres');
    expect(call.userPrompt).toContain('Explicit user constraints');
  });

  it('omits constraint block when no constraints', async () => {
    const llm = fakeProvider(crudSaasResponse);
    await recommendStack({
      llm,
      projectName: 'acme',
      answers: { project_type: 'CRUD SaaS' },
    });
    const call = (llm.generateStructured as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      userPrompt: string;
    };
    expect(call.userPrompt).not.toContain('Explicit user constraints');
  });

  it('renormalizes ranks to start at 1 with no gaps even if the model returns gapped ranks', async () => {
    const [first, second] = crudSaasResponse.recommendations;
    if (!first || !second) throw new Error('test fixture is missing recommendations');
    const response: StackRecommendations = {
      recommendations: [
        { ...first, rank: 3 },
        { ...second, rank: 7 },
      ],
      unmappedRequirements: [],
    };
    const llm = fakeProvider(response);
    const result = await recommendStack({
      llm,
      projectName: 'acme',
      answers: { project_type: 'CRUD SaaS' },
    });
    expect(result.recommendations.map((r) => r.rank)).toEqual([1, 2]);
  });

  it('formats array and boolean answer values', async () => {
    const llm = fakeProvider(crudSaasResponse);
    await recommendStack({
      llm,
      projectName: 'acme',
      answers: {
        integrations: ['stripe', 'sendgrid'],
        offline_first: true,
        analytics: false,
      },
    });
    const call = (llm.generateStructured as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      userPrompt: string;
    };
    expect(call.userPrompt).toContain('integrations: stripe, sendgrid');
    expect(call.userPrompt).toContain('offline_first: yes');
    expect(call.userPrompt).toContain('analytics: no');
  });

  it('handles unusual profiles without forcing a familiar template (e.g. browser extension)', async () => {
    const extensionResponse: StackRecommendations = {
      recommendations: [
        {
          rank: 1,
          label: 'WXT + Dexie (IndexedDB) + Y-Sweet',
          components: [
            { role: 'framework', choice: 'WXT', rationale: 'Manifest V3 browser extensions' },
            {
              role: 'storage',
              choice: 'Dexie over IndexedDB',
              rationale: 'Local-first persistence',
            },
            { role: 'sync', choice: 'Y-Sweet (Yjs)', rationale: 'CRDT-based device sync' },
          ],
          tradeoffs: ['Y-Sweet requires a sync server you operate'],
          confidence: 'medium',
          requirementsCovered: ['browser extension', 'local-first sync'],
          requirementsUnaddressed: [],
        },
      ],
      unmappedRequirements: [],
    };
    const llm = fakeProvider(extensionResponse);
    const result = await recommendStack({
      llm,
      projectName: 'extthing',
      answers: { project_type: 'Browser extension with local-first sync' },
    });
    expect(result.recommendations[0]?.label).toContain('WXT');
  });
});
