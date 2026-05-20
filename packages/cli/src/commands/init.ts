import { resolve } from 'node:path';
import { confirm } from '@inquirer/prompts';
import {
  AiFolderExistsError,
  AnthropicProvider,
  INIT_DESCRIPTION_QUESTION,
  INIT_INFERRED_FIELDS,
  MissingApiKeyError,
  ProjectInspectionError,
  UnsupportedStackError,
  assertAiFolderAbsent,
  createArchitectAgent,
  detectStack,
  generateInitTechSpec,
  injectAiFolder,
  runAdaptiveDiscovery,
  techSpecToYaml,
} from '@spex/core';
import { STRINGS } from '../strings.js';

export interface RunInitCommandOptions {
  force?: boolean;
}

export async function runInitCommand(options: RunInitCommandOptions = {}): Promise<void> {
  const projectDir = resolve(process.cwd());
  console.log(STRINGS.initCommand.starting(projectDir));

  try {
    await assertAiFolderAbsent({ projectDir, ...(options.force ? { force: true } : {}) });
  } catch (error) {
    if (error instanceof AiFolderExistsError) {
      console.error(STRINGS.initCommand.aiFolderExists(error.path));
      process.exitCode = 1;
      return;
    }
    throw error;
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

  console.log(STRINGS.initCommand.detecting);
  let stack: Awaited<ReturnType<typeof detectStack>>;
  try {
    stack = await detectStack(projectDir);
  } catch (error) {
    if (error instanceof ProjectInspectionError || error instanceof UnsupportedStackError) {
      console.error(STRINGS.initCommand.detectionFailed(error.message));
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  console.log(STRINGS.initCommand.detectionSummaryHeader);
  console.log(`  packageName:      ${stack.packageName}`);
  console.log(`  framework:        ${stack.framework}  (${stack.signals.framework})`);
  console.log(`  frameworkVersion: ${stack.frameworkVersion}  (${stack.signals.frameworkVersion})`);
  console.log(`  language:         ${stack.language}  (${stack.signals.language})`);
  console.log(`  styling:          ${stack.styling}  (${stack.signals.styling})`);
  console.log(`  appRouter:        ${stack.appRouter}  (${stack.signals.appRouter})`);
  console.log(`  srcDir:           ${stack.srcDir}  (${stack.signals.srcDir})`);
  console.log(STRINGS.initCommand.detectionSummaryFooter);

  const detectionOk = await confirm({
    message: STRINGS.initCommand.confirmDetection,
    default: true,
  });
  if (!detectionOk) {
    console.log(STRINGS.initCommand.cancelled);
    return;
  }

  console.log(STRINGS.initCommand.discoveryHeader);
  const discoveryResult = await runAdaptiveDiscovery({
    agent: createArchitectAgent({ llm, seed: INIT_DESCRIPTION_QUESTION }),
  });

  console.log(STRINGS.initCommand.generatingSpec);
  const spec = await generateInitTechSpec({
    llm,
    projectName: stack.packageName,
    stack,
    answers: discoveryResult.answers,
  });

  console.log(STRINGS.initCommand.specReady);
  console.log(techSpecToYaml(spec));
  console.log(STRINGS.initCommand.specReadyFooter);
  console.log(STRINGS.initCommand.inferredNotice(INIT_INFERRED_FIELDS));

  const approved = await confirm({
    message: STRINGS.initCommand.confirmApproveSpec,
    default: true,
  });
  if (!approved) {
    console.log(STRINGS.initCommand.cancelled);
    return;
  }

  console.log(STRINGS.initCommand.writingAi);
  await injectAiFolder({ projectDir, spec });

  console.log(STRINGS.initCommand.success(projectDir));
}
