import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScaffoldPlan, StackDecision } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/provider.js';
import { ScaffoldFailedError, runScaffold } from './scaffold-runner.js';

const decision: StackDecision = {
  label: 'Demo',
  source: 'recommended',
  components: [{ role: 'framework', choice: 'Demo Framework', rationale: 'r' }],
  rationale: 'demo',
  tradeoffs: [],
  validationWarnings: [],
};

const okPlan: ScaffoldPlan = {
  stackLabel: 'Demo',
  steps: [{ kind: 'command', cmd: 'create', args: ['demo'], rationale: 'r' }],
  postConditions: ['demo exists'],
};

let parentDir: string;
let projectDir: string;
beforeEach(async () => {
  parentDir = await mkdtemp(join(tmpdir(), 'spex-runner-'));
  projectDir = join(parentDir, 'demo');
});
afterEach(async () => {
  await rm(parentDir, { recursive: true, force: true });
});

describe('runScaffold', () => {
  it('completes on the first attempt when execution and verification both pass', async () => {
    const llm: LLMProvider = { generateStructured: vi.fn() };
    const execute = vi.fn().mockResolvedValue({ appliedSteps: 1, failure: null });
    const verify = vi.fn().mockResolvedValue({ ok: true, failedPostConditions: [], notes: '' });
    const result = await runScaffold({
      llm,
      projectName: 'demo',
      parentDir,
      projectDir,
      decision,
      initialPlan: okPlan,
      execute,
      verify,
    });
    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(execute).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledOnce();
  });

  it('self-corrects: failing first attempt followed by repaired plan that passes', async () => {
    const repaired: ScaffoldPlan = { ...okPlan, stackLabel: 'Demo (repaired)' };
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockResolvedValueOnce(repaired),
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        appliedSteps: 0,
        failure: {
          stepIndex: 0,
          step: okPlan.steps[0],
          exitCode: 1,
          stderr: 'boom',
          stdout: '',
          message: 'cmd failed',
        },
      })
      .mockResolvedValueOnce({ appliedSteps: 1, failure: null });
    const verify = vi.fn().mockResolvedValue({ ok: true, failedPostConditions: [], notes: '' });

    const events: string[] = [];
    const result = await runScaffold({
      llm,
      projectName: 'demo',
      parentDir,
      projectDir,
      decision,
      initialPlan: okPlan,
      execute,
      verify,
      onEvent: (e) => events.push(e.kind),
    });
    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(events).toContain('repairing');
    expect(events).toContain('attempt-ok');
    expect(result.plan.stackLabel).toBe('Demo (repaired)');
  });

  it('throws ScaffoldFailedError after exhausting attempts', async () => {
    const llm: LLMProvider = {
      generateStructured: vi.fn().mockResolvedValue(okPlan),
    };
    const execute = vi.fn().mockResolvedValue({ appliedSteps: 1, failure: null });
    const verify = vi
      .fn()
      .mockResolvedValue({ ok: false, failedPostConditions: ['x exists'], notes: 'still broken' });

    await expect(
      runScaffold({
        llm,
        projectName: 'demo',
        parentDir,
        projectDir,
        decision,
        initialPlan: okPlan,
        execute,
        verify,
        maxAttempts: 2,
        cleanBetweenAttempts: false,
      }),
    ).rejects.toBeInstanceOf(ScaffoldFailedError);
  });

  it('passes the failed post-conditions and command failure into the repair prompt', async () => {
    const repaired: ScaffoldPlan = { ...okPlan, stackLabel: 'Demo (repaired)' };
    const repair = vi.fn().mockResolvedValue(repaired);
    const llm: LLMProvider = { generateStructured: repair };
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        appliedSteps: 1,
        failure: null,
      })
      .mockResolvedValueOnce({ appliedSteps: 1, failure: null });
    const verify = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        failedPostConditions: ['package.json declares "next" dependency'],
        notes: 'dep not declared',
      })
      .mockResolvedValueOnce({ ok: true, failedPostConditions: [], notes: '' });

    await runScaffold({
      llm,
      projectName: 'demo',
      parentDir,
      projectDir,
      decision,
      initialPlan: okPlan,
      execute,
      verify,
      cleanBetweenAttempts: false,
    });

    expect(repair).toHaveBeenCalledOnce();
    const callArgs = repair.mock.calls[0]?.[0];
    expect(callArgs.userPrompt).toContain('package.json declares "next" dependency');
  });

  it('plans via LLM when no initialPlan is provided', async () => {
    const generated = okPlan;
    const llm: LLMProvider = { generateStructured: vi.fn().mockResolvedValue(generated) };
    const execute = vi.fn().mockResolvedValue({ appliedSteps: 1, failure: null });
    const verify = vi.fn().mockResolvedValue({ ok: true, failedPostConditions: [], notes: '' });
    const result = await runScaffold({
      llm,
      projectName: 'demo',
      parentDir,
      projectDir,
      decision,
      execute,
      verify,
    });
    expect(result.ok).toBe(true);
    expect(llm.generateStructured).toHaveBeenCalledOnce();
  });
});
