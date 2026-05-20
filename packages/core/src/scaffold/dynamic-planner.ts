import { type ScaffoldPlan, ScaffoldPlanSchema, type StackDecision } from '@spex/schemas';
import type { LLMProvider } from '../llm/provider.js';
import {
  SCAFFOLD_PLANNER_SYSTEM_PROMPT,
  buildScaffoldPlannerUserPrompt,
} from './planner-prompts.js';

export interface PlanScaffoldOptions {
  llm: LLMProvider;
  projectName: string;
  decision: StackDecision;
}

export interface RepairScaffoldPlanOptions {
  llm: LLMProvider;
  projectName: string;
  decision: StackDecision;
  previousPlan: ScaffoldPlan;
  failure: {
    failedPostConditions: readonly string[];
    commandFailures: readonly {
      cmd: string;
      args: readonly string[];
      exitCode: number | null;
      stderr: string;
    }[];
    notes: string;
  };
}

export async function planScaffold(opts: PlanScaffoldOptions): Promise<ScaffoldPlan> {
  return opts.llm.generateStructured({
    systemPrompt: SCAFFOLD_PLANNER_SYSTEM_PROMPT,
    userPrompt: buildScaffoldPlannerUserPrompt({
      projectName: opts.projectName,
      decision: opts.decision,
    }),
    schema: ScaffoldPlanSchema,
  });
}

export async function repairScaffoldPlan(opts: RepairScaffoldPlanOptions): Promise<ScaffoldPlan> {
  const previous = JSON.stringify(opts.previousPlan, null, 2);
  const failureBlocks: string[] = [];
  if (opts.failure.commandFailures.length) {
    failureBlocks.push(
      `Command failures:\n${opts.failure.commandFailures
        .map(
          (f) =>
            `- ${f.cmd} ${f.args.join(' ')} (exit ${f.exitCode ?? 'unknown'})\n  stderr: ${f.stderr.slice(0, 1500)}`,
        )
        .join('\n')}`,
    );
  }
  if (opts.failure.failedPostConditions.length) {
    failureBlocks.push(
      `Failed post-conditions:\n${opts.failure.failedPostConditions.map((c) => `- ${c}`).join('\n')}`,
    );
  }
  if (opts.failure.notes) {
    failureBlocks.push(`Notes:\n${opts.failure.notes}`);
  }

  const repairUser = `Project name: ${opts.projectName}
Stack: ${opts.decision.label}

The previous scaffold plan failed. Produce a REVISED ScaffoldPlan that addresses the failures below. Keep the parts of the plan that succeeded and rewrite only what failed. Do NOT repeat the same failing command verbatim.

Previous plan:
\`\`\`json
${previous}
\`\`\`

Failures:
${failureBlocks.join('\n\n')}
`;

  return opts.llm.generateStructured({
    systemPrompt: SCAFFOLD_PLANNER_SYSTEM_PROMPT,
    userPrompt: repairUser,
    schema: ScaffoldPlanSchema,
  });
}
