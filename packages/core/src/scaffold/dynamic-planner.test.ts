import type { ScaffoldPlan, StackDecision } from '@spex/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/provider.js';
import { planScaffold, repairScaffoldPlan } from './dynamic-planner.js';

const nextjsDecision: StackDecision = {
  label: 'Next.js + Tailwind',
  source: 'recommended',
  components: [
    { role: 'framework', choice: 'Next.js 15 App Router', rationale: 'SSR web app' },
    { role: 'styling', choice: 'Tailwind CSS', rationale: 'Rapid styling' },
  ],
  rationale: 'Standard SSR web app.',
  tradeoffs: [],
  validationWarnings: [],
};

const nextjsPlan: ScaffoldPlan = {
  stackLabel: 'Next.js + Tailwind',
  steps: [
    {
      kind: 'command',
      cmd: 'pnpm',
      args: [
        'create',
        'next-app@latest',
        'demo',
        '--typescript',
        '--tailwind',
        '--app',
        '--src-dir',
        '--import-alias',
        '@/*',
        '--use-pnpm',
      ],
      rationale: 'Official scaffolder for Next.js + Tailwind',
    },
  ],
  postConditions: ['package.json declares "next" dependency', 'src/app/page.tsx exists'],
};

const exoticDecision: StackDecision = {
  label: 'WXT + Dexie + Y-Sweet',
  source: 'user',
  components: [
    { role: 'framework', choice: 'WXT', rationale: 'Browser extension framework' },
    { role: 'storage', choice: 'Dexie / IndexedDB', rationale: 'Local-first persistence' },
    { role: 'sync', choice: 'Y-Sweet', rationale: 'CRDT sync' },
  ],
  rationale: 'Browser extension with local-first sync.',
  tradeoffs: [],
  validationWarnings: [],
};

const exoticPlan: ScaffoldPlan = {
  stackLabel: 'WXT + Dexie + Y-Sweet',
  steps: [
    {
      kind: 'command',
      cmd: 'pnpm',
      args: ['create', 'wxt@latest', 'demo', '--', '--template', 'react'],
      rationale: 'WXT official scaffolder',
    },
    {
      kind: 'command',
      cmd: 'pnpm',
      args: ['add', 'dexie', '@y-sweet/sdk', 'yjs'],
      rationale: 'Storage + sync dependencies',
    },
    {
      kind: 'file',
      path: 'src/db.ts',
      content: "import Dexie from 'dexie';\nexport const db = new Dexie('demo');\n",
      rationale: 'Local-first Dexie database',
    },
  ],
  postConditions: [
    "package.json declares 'dexie' dependency",
    "package.json declares 'yjs' dependency",
    'src/db.ts exists',
  ],
};

describe('planScaffold', () => {
  it('forwards the planner prompts and decision to the LLM and returns the plan', async () => {
    const generate = vi.fn().mockResolvedValue(nextjsPlan);
    const llm: LLMProvider = { generateStructured: generate };
    const plan = await planScaffold({ llm, projectName: 'demo', decision: nextjsDecision });
    expect(plan).toEqual(nextjsPlan);
    const call = generate.mock.calls[0]?.[0];
    expect(call.userPrompt).toContain('Project name: demo');
    expect(call.userPrompt).toContain('label: Next.js + Tailwind');
    expect(call.systemPrompt).toMatch(/ScaffoldPlan/);
  });

  it('reproduces the Sprint 1 Next.js scaffolder command (regression guard)', async () => {
    const generate = vi.fn().mockResolvedValue(nextjsPlan);
    const llm: LLMProvider = { generateStructured: generate };
    const plan = await planScaffold({ llm, projectName: 'demo', decision: nextjsDecision });
    const first = plan.steps[0];
    expect(first?.kind).toBe('command');
    if (first?.kind === 'command') {
      expect(first.cmd).toBe('pnpm');
      expect(first.args.join(' ')).toContain('create');
      expect(first.args.join(' ')).toContain('next-app@latest');
      expect(first.args.join(' ')).toContain('--typescript');
      expect(first.args.join(' ')).toContain('--use-pnpm');
    }
  });

  it('produces a coherent plan for a stack with no widely-known scaffolder', async () => {
    const generate = vi.fn().mockResolvedValue(exoticPlan);
    const llm: LLMProvider = { generateStructured: generate };
    const plan = await planScaffold({ llm, projectName: 'demo', decision: exoticDecision });
    expect(plan.steps.length).toBeGreaterThan(1);
    expect(plan.postConditions.some((c) => c.includes('dexie'))).toBe(true);
    const fileSteps = plan.steps.filter((s) => s.kind === 'file');
    expect(fileSteps.length).toBeGreaterThan(0);
  });

  it('returns plans whose steps each carry a rationale', async () => {
    const generate = vi.fn().mockResolvedValue(exoticPlan);
    const llm: LLMProvider = { generateStructured: generate };
    const plan = await planScaffold({ llm, projectName: 'demo', decision: exoticDecision });
    for (const step of plan.steps) {
      expect(step.rationale.length).toBeGreaterThan(0);
    }
  });
});

describe('repairScaffoldPlan', () => {
  it('includes the previous plan and failure context in the LLM prompt', async () => {
    const repaired: ScaffoldPlan = {
      ...nextjsPlan,
      steps: [
        {
          kind: 'command',
          cmd: 'pnpm',
          args: [
            'create',
            'next-app@latest',
            'demo',
            '--typescript',
            '--tailwind',
            '--app',
            '--src-dir',
            '--use-pnpm',
          ],
          rationale: 'Drop import-alias flag that caused failure',
        },
      ],
    };
    const generate = vi.fn().mockResolvedValue(repaired);
    const llm: LLMProvider = { generateStructured: generate };
    const out = await repairScaffoldPlan({
      llm,
      projectName: 'demo',
      decision: nextjsDecision,
      previousPlan: nextjsPlan,
      failure: {
        failedPostConditions: [],
        commandFailures: [
          {
            cmd: 'pnpm',
            args: ['create', 'next-app@latest', 'demo'],
            exitCode: 1,
            stderr: 'unknown flag --import-alias',
          },
        ],
        notes: '',
      },
    });
    expect(out).toBe(repaired);
    const call = generate.mock.calls[0]?.[0];
    expect(call.userPrompt).toContain('Previous plan:');
    expect(call.userPrompt).toContain('unknown flag --import-alias');
    expect(call.userPrompt).toContain('Do NOT repeat the same failing command verbatim.');
  });
});
