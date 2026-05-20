import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { confirm } from '@inquirer/prompts';
import {
  AnthropicProvider,
  MissingApiKeyError,
  ScaffoldFailedError,
  generateTechSpec,
  injectAiFolder,
  runCommand,
  runDiscovery,
  runScaffold,
  techSpecToYaml,
} from '@spex/core';
import { type StackSelectionEntryState, runStackSelection } from '../flows/stack-selection.js';
import { STRINGS } from '../strings.js';

const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface NewCommandOptions {
  stack?: string;
  constraints?: string;
  brainstorm?: boolean;
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

  if (existsSync(projectDir)) {
    console.error(STRINGS.errors.projectExists(projectName));
    process.exitCode = 1;
    return;
  }

  console.log(STRINGS.newCommand.aboutToCreate(projectName));
  const confirmedName = await confirm({
    message: STRINGS.newCommand.confirmProjectName(projectName),
    default: true,
  });
  if (!confirmedName) {
    console.log(STRINGS.newCommand.cancelled);
    return;
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

  console.log(STRINGS.newCommand.discoveryHeader);
  const answers = await runDiscovery();

  console.log(STRINGS.newCommand.selectingStackHeader);
  const entry = pickEntryState(options);
  const decision = await runStackSelection({
    llm,
    projectName,
    answers,
    entry,
  });

  console.log(STRINGS.newCommand.generatingSpec);
  const spec = await generateTechSpec({ llm, projectName, answers, decision });

  console.log(STRINGS.newCommand.specReady);
  console.log(techSpecToYaml(spec));
  console.log(STRINGS.newCommand.specReadyFooter);

  const approvedSpec = await confirm({
    message: STRINGS.newCommand.confirmApproveSpec,
    default: true,
  });
  if (!approvedSpec) {
    console.log(STRINGS.newCommand.cancelled);
    return;
  }

  console.log(STRINGS.newCommand.scaffolding(projectName));
  try {
    await runScaffold({
      llm,
      projectName,
      parentDir,
      projectDir,
      decision,
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
