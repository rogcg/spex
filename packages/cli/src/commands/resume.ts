import { resolve } from 'node:path';
import { confirm, select } from '@inquirer/prompts';
import { type WorkflowSummary, createStateStore } from '@spex/core';
import { STRINGS } from '../strings.js';

export interface ResumeCommandOptions {
  workflowId?: string;
  list?: boolean;
  abandon?: string;
  projectDir?: string;
}

/**
 * `spex resume` — detect paused/incomplete workflows under `.ai/scratch/` and
 * offer to resume, list, or abandon them. The actual resume per workflow-kind
 * is delegated back to each existing flow's resume entry point — this command
 * is a router/inspector for the scratch directory.
 */
export async function runResumeCommand(options: ResumeCommandOptions = {}): Promise<void> {
  const projectDir = options.projectDir ?? resolve(process.cwd());
  const store = createStateStore({ projectDir });

  if (options.abandon) {
    await abandonWorkflow(store, options.abandon);
    return;
  }

  const summaries = await store.list();

  if (options.list) {
    printList(summaries);
    return;
  }

  if (summaries.length === 0) {
    console.log(STRINGS.resumeCommand.noWorkflows);
    return;
  }

  if (options.workflowId) {
    const match = summaries.find((s) => s.workflowId === options.workflowId);
    if (!match) {
      throw new Error(STRINGS.resumeCommand.notFound(options.workflowId));
    }
    await resumeOne(match);
    return;
  }

  const active = summaries.filter(
    (s) => s.status === 'paused' || s.status === 'running' || s.status === 'crashed',
  );

  if (active.length === 0) {
    console.log(STRINGS.resumeCommand.noActiveWorkflows);
    printList(summaries);
    return;
  }

  if (active.length === 1) {
    const only = active[0] as WorkflowSummary;
    const proceed = await confirm({
      message: STRINGS.resumeCommand.confirmResumeOne(only.workflowId, only.kind),
      default: true,
    });
    if (!proceed) {
      console.log(STRINGS.resumeCommand.cancelled);
      return;
    }
    await resumeOne(only);
    return;
  }

  const choice = await select({
    message: STRINGS.resumeCommand.pickPrompt,
    choices: active.map((s) => ({
      name: `[${s.kind}] ${s.workflowId} — ${s.status} — last activity ${s.lastActivityAt}${
        s.description ? ` — ${s.description}` : ''
      }`,
      value: s.workflowId,
    })),
  });
  const picked = active.find((s) => s.workflowId === choice);
  if (picked) {
    await resumeOne(picked);
  }
}

async function abandonWorkflow(
  store: ReturnType<typeof createStateStore>,
  workflowId: string,
): Promise<void> {
  const state = await store.load(workflowId);
  if (!state) {
    throw new Error(STRINGS.resumeCommand.notFound(workflowId));
  }
  await store.save({
    ...state,
    status: 'abandoned',
    updatedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
  });
  await store.delete(workflowId);
  console.log(STRINGS.resumeCommand.abandoned(workflowId));
}

function printList(summaries: readonly WorkflowSummary[]): void {
  if (summaries.length === 0) {
    console.log(STRINGS.resumeCommand.noWorkflows);
    return;
  }
  console.log(STRINGS.resumeCommand.header);
  for (const s of summaries) {
    console.log(STRINGS.resumeCommand.listEntry(s));
  }
}

async function resumeOne(summary: WorkflowSummary): Promise<void> {
  console.log(STRINGS.resumeCommand.resumingHeader(summary.workflowId, summary.kind));
  console.log(STRINGS.resumeCommand.resumeNotice(summary.kind));
}
