import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { confirm } from '@inquirer/prompts';
import {
  AnthropicProvider,
  MissingApiKeyError,
  generateTechSpec,
  injectAiFolder,
  runCommand,
  runDiscovery,
  scaffoldNextJsApp,
  techSpecToYaml,
} from '@spex/core';
import { STRINGS } from '../strings.js';

const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export async function runNewCommand(projectName: string): Promise<void> {
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

  console.log(STRINGS.newCommand.generatingSpec);
  const spec = await generateTechSpec({ llm, projectName, answers });

  console.log(STRINGS.newCommand.specReady);
  console.log(techSpecToYaml(spec));
  console.log(STRINGS.newCommand.specReadyFooter);

  const approved = await confirm({
    message: STRINGS.newCommand.confirmApproveSpec,
    default: true,
  });
  if (!approved) {
    console.log(STRINGS.newCommand.cancelled);
    return;
  }

  console.log(STRINGS.newCommand.scaffolding(projectName));
  await scaffoldNextJsApp({ projectName, parentDir });

  console.log(STRINGS.newCommand.injectingAi);
  await injectAiFolder({ projectDir, spec });

  console.log(STRINGS.newCommand.gitInit);
  await runCommand('git', ['init'], { cwd: projectDir });
  await runCommand('git', ['add', '.ai'], { cwd: projectDir });
  await runCommand('git', ['commit', '-m', 'chore: add SPEX .ai/ folder'], { cwd: projectDir });

  console.log(STRINGS.newCommand.success(projectName, projectDir));
}
