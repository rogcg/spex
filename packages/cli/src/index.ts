import { Command } from 'commander';
import { runFixCommand } from './commands/fix.js';
import { runGithubSetupCommand } from './commands/github-setup.js';
import { runImplementCommand } from './commands/implement.js';
import { runInitCommand } from './commands/init.js';
import { runLinearSyncCommand } from './commands/linear-sync.js';
import { runMcpServerCommand } from './commands/mcp-server.js';
import { runNewCommand } from './commands/new.js';
import { runPostHogWebhookCommand } from './commands/posthog-webhook.js';
import { runReviewCommand } from './commands/review.js';
import { parseSkillsInstallScope, runSkillsInstallCommand } from './commands/skills-install.js';
import { runSlackWebhookCommand } from './commands/slack-webhook.js';
import { STRINGS } from './strings.js';
import { printBanner } from './ui/banner.js';

/** Commander collector for repeatable options like `--affected <path>`. */
function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function handleError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  // Errors are reported to stderr so they never corrupt the MCP stdio protocol
  // when the failure happens inside `spex mcp-server`.
  process.stderr.write(`${STRINGS.errors.generic(message)}\n`);
  process.exit(1);
}

const program = new Command();

program.name('spex').description('SPEX — Spec-driven Programming EXecutor');

program
  .command('new')
  .description(STRINGS.newCommand.description)
  .argument('<name>', STRINGS.newCommand.argDescription)
  .option('--stack <label>', STRINGS.newCommand.stackFlagDescription)
  .option('--constraints <text>', STRINGS.newCommand.constraintsFlagDescription)
  .option('--brainstorm', STRINGS.newCommand.brainstormFlagDescription)
  .option('--auto', STRINGS.newCommand.autoFlagDescription)
  .option('--strict', STRINGS.newCommand.strictFlagDescription)
  .option('--resume', STRINGS.newCommand.resumeFlagDescription)
  .action(
    async (
      name: string,
      opts: {
        stack?: string;
        constraints?: string;
        brainstorm?: boolean;
        auto?: boolean;
        strict?: boolean;
        resume?: boolean;
      },
    ) => {
      printBanner();
      try {
        await runNewCommand(name, {
          ...(opts.stack ? { stack: opts.stack } : {}),
          ...(opts.constraints ? { constraints: opts.constraints } : {}),
          ...(opts.brainstorm ? { brainstorm: true } : {}),
          ...(opts.auto ? { auto: true } : {}),
          ...(opts.strict ? { strict: true } : {}),
          ...(opts.resume ? { resume: true } : {}),
        });
      } catch (error) {
        handleError(error);
      }
    },
  );

program
  .command('init')
  .description(STRINGS.initCommand.description)
  .option('-f, --force', STRINGS.initCommand.forceFlagDescription)
  .action(async (opts: { force?: boolean }) => {
    printBanner();
    try {
      await runInitCommand({ ...(opts.force ? { force: true } : {}) });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('implement')
  .description(STRINGS.implementCommand.description)
  .argument('[description]', STRINGS.implementCommand.argDescription)
  .option('--auto', STRINGS.implementCommand.autoFlagDescription)
  .option('--dry-run', STRINGS.implementCommand.dryRunFlagDescription)
  .option('--no-git', STRINGS.implementCommand.noGitFlagDescription)
  .option('--from-issue <id>', STRINGS.implementCommand.fromIssueFlagDescription)
  .action(
    async (
      description: string | undefined,
      opts: { auto?: boolean; dryRun?: boolean; git?: boolean; fromIssue?: string },
    ) => {
      printBanner();
      try {
        await runImplementCommand(description, {
          ...(opts.auto ? { auto: true } : {}),
          ...(opts.dryRun ? { dryRun: true } : {}),
          ...(opts.git === false ? { noGit: true } : {}),
          ...(opts.fromIssue ? { fromIssue: opts.fromIssue } : {}),
        });
      } catch (error) {
        handleError(error);
      }
    },
  );

program
  .command('fix')
  .description(STRINGS.fixCommand.description)
  .argument('[description]', STRINGS.fixCommand.argDescription)
  .option(
    '-a, --affected <path>',
    STRINGS.fixCommand.affectedFlagDescription,
    collectRepeatable,
    [],
  )
  .option('--error-message <text>', STRINGS.fixCommand.errorMessageFlagDescription)
  .option('--error-stack <text>', STRINGS.fixCommand.errorStackFlagDescription)
  .option('--auto', STRINGS.fixCommand.autoFlagDescription)
  .option('--dry-run', STRINGS.fixCommand.dryRunFlagDescription)
  .option('--no-git', STRINGS.fixCommand.noGitFlagDescription)
  .option('--from-error <ref>', STRINGS.fixCommand.fromErrorFlagDescription)
  .action(
    async (
      description: string | undefined,
      opts: {
        affected?: string[];
        errorMessage?: string;
        errorStack?: string;
        auto?: boolean;
        dryRun?: boolean;
        git?: boolean;
        fromError?: string;
      },
    ) => {
      printBanner();
      try {
        await runFixCommand(description, {
          ...(opts.affected && opts.affected.length > 0 ? { affected: opts.affected } : {}),
          ...(opts.errorMessage ? { errorMessage: opts.errorMessage } : {}),
          ...(opts.errorStack ? { errorStack: opts.errorStack } : {}),
          ...(opts.auto ? { auto: true } : {}),
          ...(opts.dryRun ? { dryRun: true } : {}),
          ...(opts.git === false ? { noGit: true } : {}),
          ...(opts.fromError ? { fromError: opts.fromError } : {}),
        });
      } catch (error) {
        handleError(error);
      }
    },
  );

program
  .command('review')
  .description(STRINGS.reviewCommand.description)
  .argument('[pr-ref]', STRINGS.reviewCommand.argDescription)
  .option('--auto', STRINGS.reviewCommand.autoFlagDescription)
  .option('--dry-run', STRINGS.reviewCommand.dryRunFlagDescription)
  .action(async (ref: string | undefined, opts: { auto?: boolean; dryRun?: boolean }) => {
    printBanner();
    try {
      await runReviewCommand(ref, {
        ...(opts.auto ? { auto: true } : {}),
        ...(opts.dryRun ? { dryRun: true } : {}),
      });
    } catch (error) {
      handleError(error);
    }
  });

const github = program.command('github').description(STRINGS.githubSetupCommand.description);

github
  .command('setup')
  .description(STRINGS.githubSetupCommand.setupDescription)
  .option('--force', STRINGS.githubSetupCommand.forceFlagDescription)
  .action(async (opts: { force?: boolean }) => {
    printBanner();
    try {
      await runGithubSetupCommand({ ...(opts.force ? { force: true } : {}) });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('linear-sync')
  .description(STRINGS.linearSyncCommand.description)
  .option('--event <event>', STRINGS.linearSyncCommand.eventFlagDescription)
  .option('--event-path <path>', STRINGS.linearSyncCommand.eventPathFlagDescription)
  .option('--linear-id <id>', STRINGS.linearSyncCommand.linearIdFlagDescription)
  .option('--pr-number <number>', STRINGS.linearSyncCommand.prNumberFlagDescription)
  .option('--pr-url <url>', STRINGS.linearSyncCommand.prUrlFlagDescription)
  .option('--branch <ref>', STRINGS.linearSyncCommand.branchFlagDescription)
  .option('--pr-body <text>', STRINGS.linearSyncCommand.prBodyFlagDescription)
  .option('--dry-run', STRINGS.linearSyncCommand.dryRunFlagDescription)
  .action(
    async (opts: {
      event?: string;
      eventPath?: string;
      linearId?: string;
      prNumber?: string;
      prUrl?: string;
      branch?: string;
      prBody?: string;
      dryRun?: boolean;
    }) => {
      printBanner();
      try {
        await runLinearSyncCommand({
          ...(opts.event !== undefined ? { event: opts.event } : {}),
          ...(opts.eventPath !== undefined ? { eventPath: opts.eventPath } : {}),
          ...(opts.linearId !== undefined ? { linearId: opts.linearId } : {}),
          ...(opts.prNumber !== undefined ? { prNumber: Number(opts.prNumber) } : {}),
          ...(opts.prUrl !== undefined ? { prUrl: opts.prUrl } : {}),
          ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
          ...(opts.prBody !== undefined ? { prBody: opts.prBody } : {}),
          ...(opts.dryRun ? { dryRun: true } : {}),
        });
      } catch (error) {
        handleError(error);
      }
    },
  );

program
  .command('posthog-webhook')
  .description(STRINGS.posthogWebhookCommand.description)
  .option('--payload-path <path>', STRINGS.posthogWebhookCommand.payloadPathFlagDescription)
  .option('--signature <header>', STRINGS.posthogWebhookCommand.signatureFlagDescription)
  .option('--secret <secret>', STRINGS.posthogWebhookCommand.secretFlagDescription)
  .option('--dry-run', STRINGS.posthogWebhookCommand.dryRunFlagDescription)
  .action(
    async (opts: {
      payloadPath?: string;
      signature?: string;
      secret?: string;
      dryRun?: boolean;
    }) => {
      printBanner();
      try {
        await runPostHogWebhookCommand({
          ...(opts.payloadPath !== undefined ? { payloadPath: opts.payloadPath } : {}),
          ...(opts.signature !== undefined ? { signature: opts.signature } : {}),
          ...(opts.secret !== undefined ? { secret: opts.secret } : {}),
          ...(opts.dryRun ? { dryRun: true } : {}),
        });
      } catch (error) {
        handleError(error);
      }
    },
  );

program
  .command('slack-webhook')
  .description(STRINGS.slackWebhookCommand.description)
  .option('--payload-path <path>', STRINGS.slackWebhookCommand.payloadPathFlagDescription)
  .option('--signature <header>', STRINGS.slackWebhookCommand.signatureFlagDescription)
  .option('--timestamp <header>', STRINGS.slackWebhookCommand.timestampFlagDescription)
  .option('--secret <secret>', STRINGS.slackWebhookCommand.secretFlagDescription)
  .option('--dry-run', STRINGS.slackWebhookCommand.dryRunFlagDescription)
  .action(
    async (opts: {
      payloadPath?: string;
      signature?: string;
      timestamp?: string;
      secret?: string;
      dryRun?: boolean;
    }) => {
      printBanner();
      try {
        await runSlackWebhookCommand({
          ...(opts.payloadPath !== undefined ? { payloadPath: opts.payloadPath } : {}),
          ...(opts.signature !== undefined ? { signature: opts.signature } : {}),
          ...(opts.timestamp !== undefined ? { timestamp: opts.timestamp } : {}),
          ...(opts.secret !== undefined ? { secret: opts.secret } : {}),
          ...(opts.dryRun ? { dryRun: true } : {}),
        });
      } catch (error) {
        handleError(error);
      }
    },
  );

const skills = program.command('skills').description(STRINGS.skillsCommand.description);

skills
  .command('install')
  .description(STRINGS.skillsInstallCommand.description)
  .option('--scope <scope>', STRINGS.skillsInstallCommand.scopeFlagDescription, 'user')
  .action(async (opts: { scope?: string }) => {
    printBanner();
    try {
      const scope = parseSkillsInstallScope(opts.scope ?? 'user');
      await runSkillsInstallCommand({ scope });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('mcp-server')
  .description(STRINGS.mcpServerCommand.description)
  .option('--transport <transport>', STRINGS.mcpServerCommand.transportFlagDescription, 'stdio')
  .option('--port <port>', STRINGS.mcpServerCommand.portFlagDescription)
  .action(async (opts: { transport?: string; port?: string }) => {
    // No banner here: this command speaks MCP JSON-RPC on stdout. Any banner
    // text would corrupt the protocol stream for the connected IDE.
    try {
      await runMcpServerCommand({
        ...(opts.transport !== undefined ? { transport: opts.transport } : {}),
        ...(opts.port !== undefined ? { port: opts.port } : {}),
      });
    } catch (error) {
      handleError(error);
    }
  });

await program.parseAsync(process.argv).catch(handleError);
