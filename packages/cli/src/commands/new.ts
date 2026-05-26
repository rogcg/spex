import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { confirm } from '@inquirer/prompts';
import {
  AnthropicProvider,
  type DiscoveryResult,
  MissingApiKeyError,
  ProposalPausedError,
  ScaffoldFailedError,
  appendDecisionAuditEntry,
  assembleTechSpec,
  auditLogPath,
  createArchitectAgent,
  generateProposalDecisions,
  injectAiFolder,
  loadProposalState,
  runAdaptiveDiscovery,
  runCommand,
  runProposalApproval,
  runScaffold,
  techSpecToYaml,
} from '@spex/core';
import type { Decision } from '@spex/schemas';
import { defaultDecisionPrompter } from '../flows/decision-approval.js';
import {
  persistAnthropicApiKey,
  promptForAnthropicApiKey,
} from '../flows/ensure-api-key.js';
import { type StackSelectionEntryState, runStackSelection } from '../flows/stack-selection.js';
import { STRINGS } from '../strings.js';

const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface NewCommandOptions {
  stack?: string;
  constraints?: string;
  brainstorm?: boolean;
  auto?: boolean;
  strict?: boolean;
  resume?: boolean;
}

export async function runNewCommand(
  projectName: string,
  options: NewCommandOptions = {},
): Promise<void> {
  if (!PROJECT_NAME_PATTERN.test(projectName)) {
    console.error(STRINGS.errors.invalidProjectName(projectName));
    process.exitCode = 1;
    return;
  }

  const parentDir = process.cwd();
  const projectDir = resolve(parentDir, projectName);
  const scratchPath = resolve(parentDir, `.${projectName}-spex-proposal.yaml`);

  let resumeState: Awaited<ReturnType<typeof loadProposalState>> | null = null;
  if (options.resume) {
    if (!existsSync(scratchPath)) {
      console.error(`Error: no paused proposal found at ${scratchPath}.`);
      process.exitCode = 1;
      return;
    }
    resumeState = await loadProposalState(scratchPath);
    console.log(STRINGS.newCommand.proposalResuming(scratchPath));
  }

  if (!resumeState && existsSync(projectDir)) {
    console.error(STRINGS.errors.projectExists(projectName));
    process.exitCode = 1;
    return;
  }

  if (!resumeState) {
    console.log(STRINGS.newCommand.aboutToCreate(projectName));
    const confirmedName = await confirm({
      message: STRINGS.newCommand.confirmProjectName(projectName),
      default: true,
    });
    if (!confirmedName) {
      console.log(STRINGS.newCommand.cancelled);
      return;
    }
  }

  let promptedApiKey: string | undefined;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(STRINGS.apiKey.notFoundNotice);
    promptedApiKey = await promptForAnthropicApiKey();
    process.env.ANTHROPIC_API_KEY = promptedApiKey;
  }

  let llm: AnthropicProvider;
  try {
    llm = new AnthropicProvider();
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      console.error(STRINGS.errors.missingApiKey(error.envVar));
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  let initialDecisions: Decision[];
  let startIndex = 0;
  let stackDecisionResult: Awaited<ReturnType<typeof runStackSelection>>;
  let discoveryResult: DiscoveryResult;

  if (resumeState) {
    // Resume path: rehydrate decisions from scratch state. Discovery and
    // stack selection are re-run because they're cheap and they re-populate
    // the in-memory state used by downstream steps; the decision list itself
    // is preserved verbatim and we re-enter the gates at the saved index.
    console.log(STRINGS.newCommand.discoveryHeader);
    discoveryResult = await runAdaptiveDiscovery({ agent: createArchitectAgent({ llm }) });
    console.log(STRINGS.newCommand.selectingStackHeader);
    stackDecisionResult = await runStackSelection({
      llm,
      projectName,
      answers: discoveryResult.answers,
      entry: pickEntryState(options),
    });
    initialDecisions = resumeState.decisions;
    startIndex = resumeState.currentIndex;
  } else {
    console.log(STRINGS.newCommand.discoveryHeader);
    discoveryResult = await runAdaptiveDiscovery({ agent: createArchitectAgent({ llm }) });

    console.log(STRINGS.newCommand.selectingStackHeader);
    stackDecisionResult = await runStackSelection({
      llm,
      projectName,
      answers: discoveryResult.answers,
      entry: pickEntryState(options),
    });

    console.log(STRINGS.newCommand.generatingProposalHeader);
    initialDecisions = await generateProposalDecisions({
      llm,
      projectName,
      answers: discoveryResult.answers,
      decision: stackDecisionResult,
    });
    console.log(STRINGS.newCommand.proposalDecisionCount(initialDecisions.length));
  }

  if (options.auto) {
    console.log(STRINGS.newCommand.autoModeWarning);
    if (options.strict) {
      console.log(STRINGS.newCommand.autoStrictReminder);
    }
  } else {
    console.log(STRINGS.newCommand.iterativeGatesHeader);
  }

  const auditLog = auditLogPath({ projectDir });
  const stagedAuditEntries: Parameters<typeof appendDecisionAuditEntry>[1][] = [];

  let approvedDecisions: Decision[];
  try {
    const result = await runProposalApproval({
      llm,
      projectName,
      decisions: initialDecisions,
      prompter: defaultDecisionPrompter(),
      audit: {
        async write(entry) {
          stagedAuditEntries.push(entry);
        },
      },
      ...(options.auto ? { auto: true } : {}),
      ...(options.strict ? { strict: true } : {}),
      scratchPath,
      ...(startIndex > 0 ? { startIndex } : {}),
    });
    approvedDecisions = result.decisions;
  } catch (error) {
    if (error instanceof ProposalPausedError) {
      console.log(STRINGS.newCommand.proposalPaused(error.scratchPath));
      return;
    }
    throw error;
  }

  console.log(STRINGS.newCommand.assembleSpec);
  const spec = assembleTechSpec({
    projectName,
    answers: discoveryResult.answers,
    stackDecision: stackDecisionResult,
    decisions: approvedDecisions,
  });

  console.log(STRINGS.newCommand.specReady);
  console.log(techSpecToYaml(spec));
  console.log(STRINGS.newCommand.specReadyFooter);

  if (!options.auto) {
    const approvedSpec = await confirm({
      message: STRINGS.newCommand.confirmApproveSpec,
      default: true,
    });
    if (!approvedSpec) {
      console.log(STRINGS.newCommand.cancelled);
      return;
    }
  }

  console.log(STRINGS.newCommand.scaffolding(projectName));
  try {
    await runScaffold({
      llm,
      projectName,
      parentDir,
      projectDir,
      decision: stackDecisionResult,
      onEvent: (event) => {
        switch (event.kind) {
          case 'planning':
            console.log(STRINGS.newCommand.planningScaffold);
            break;
          case 'attempt-start':
            console.log(STRINGS.newCommand.scaffoldAttempt(event.attempt, event.max));
            break;
          case 'attempt-failed':
            console.log(STRINGS.newCommand.scaffoldVerificationFailed(event.reason));
            break;
          case 'repairing':
            console.log(STRINGS.newCommand.scaffoldSelfCorrecting);
            break;
          case 'attempt-ok':
            console.log(STRINGS.newCommand.scaffoldAttemptOk);
            break;
          case 'aborting':
            console.log(STRINGS.newCommand.scaffoldFinalFailure(event.attempts));
            break;
          default:
            break;
        }
      },
    });
  } catch (error) {
    if (error instanceof ScaffoldFailedError) {
      await rm(projectDir, { recursive: true, force: true }).catch(() => {});
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  console.log(STRINGS.newCommand.injectingAi);
  await injectAiFolder({ projectDir, spec });

  if (promptedApiKey) {
    const savedPath = persistAnthropicApiKey({ projectDir, key: promptedApiKey });
    if (savedPath) console.log(STRINGS.apiKey.savedTo(savedPath));
  }

  // Flush staged audit entries into the now-existing project .ai/audit/ folder.
  for (const entry of stagedAuditEntries) {
    await appendDecisionAuditEntry(auditLog, entry);
  }
  console.log(STRINGS.newCommand.auditWritten(auditLog));

  // Clean up the transient scratch file from a successful run.
  await rm(scratchPath, { force: true }).catch(() => {});

  console.log(STRINGS.newCommand.gitInit);
  await runCommand('git', ['init'], { cwd: projectDir });
  await runCommand('git', ['add', '.ai'], { cwd: projectDir });
  await runCommand('git', ['commit', '-m', 'chore: add SPEX .ai/ folder'], { cwd: projectDir });

  console.log(STRINGS.newCommand.success(projectName, projectDir));
}

function pickEntryState(options: NewCommandOptions): StackSelectionEntryState {
  if (options.brainstorm) return { kind: 'brainstorm' };
  if (options.stack) return { kind: 'explicit-choice', choice: options.stack };
  if (options.constraints) return { kind: 'partial-constraints', constraints: options.constraints };
  return { kind: 'no-preference' };
}
