#!/usr/bin/env node
/**
 * SPEX Linear integration sandbox.
 *
 * Exercises the full @spex/integrations-linear surface against the real
 * Linear MCP server so changes are visible in the Linear UI in real time.
 *
 * Steps:
 *   1. Connect to https://mcp.linear.app/mcp using LINEAR_API_KEY
 *   2. Discover available MCP tools (verifies tool name assumptions)
 *   3. List existing teams (sanity check)
 *   4. Try to create a sandbox project (if create_project is supported)
 *   5. Create three issues attached to the sandbox project
 *   6. Exercise the PR ↔ Linear sync function with synthesised GitHub
 *      events: opened → In Review, merged → Done, closed_unmerged → Todo
 *   7. Drive the same flow through the built `spex linear-sync` CLI to
 *      prove end-to-end CLI parity
 *
 * Usage:
 *   LINEAR_API_KEY=<key> node scripts/linear-sandbox.mjs
 *
 * Optional env:
 *   SPEX_LINEAR_TEAM=<team key or id>   (defaults to first team listed)
 *   SPEX_SANDBOX_KEEP=1                  (skip post-run cleanup hint)
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LINEAR_TOOLS,
  addLinearComment,
  closeAllLinearMcpClients,
  createLinearIssue,
  createLinearMcpClient,
  getLinearIssue,
  syncPrEventToLinear,
  updateLinearIssueStatus,
} from '../packages/integrations/linear/dist/index.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = resolve(REPO_ROOT, 'packages/cli/dist/index.js');

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');

const STATUS_MAPPING = {
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  todo: 'Todo',
};

function header(step, total, title) {
  console.log(`\n[${step}/${total}] ${title}`);
}

function check(message) {
  console.log(`  ✓ ${message}`);
}

function note(message) {
  console.log(`    ${message}`);
}

function warn(message) {
  console.warn(`  ⚠ ${message}`);
}

function preflight() {
  const key = (process.env.LINEAR_API_KEY ?? '').trim();
  if (key.length === 0) {
    console.error('Error: LINEAR_API_KEY is not set.');
    console.error('Pass it inline:  LINEAR_API_KEY=<key> node scripts/linear-sandbox.mjs');
    process.exit(1);
  }
}

async function listTools(client) {
  // The SDK's `client.listTools()` returns `{ tools: [...] }`.
  const result = await client.client.listTools();
  return result.tools.map((t) => t.name).sort();
}

async function callRawTool(client, name, args) {
  const result = await client.client.callTool({ name, arguments: args });
  if (result.isError === true) {
    const text = (result.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    throw new Error(`Tool ${name} returned error: ${text || 'unknown'}`);
  }
  return result.structuredContent !== undefined
    ? result.structuredContent
    : tryParseJsonText(result.content);
}

function tryParseJsonText(content) {
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (part?.type === 'text' && typeof part.text === 'string') {
      try {
        return JSON.parse(part.text);
      } catch {
        // fall through
      }
    }
  }
  return null;
}

function pickTeam(teams) {
  const preferred = (process.env.SPEX_LINEAR_TEAM ?? '').trim();
  if (preferred.length > 0) {
    const match = teams.find(
      (t) => t.id === preferred || t.key === preferred || t.name === preferred,
    );
    if (!match) {
      throw new Error(
        `SPEX_LINEAR_TEAM="${preferred}" did not match any team. Available: ${teams
          .map((t) => `${t.key} (${t.name})`)
          .join(', ')}`,
      );
    }
    return match;
  }
  if (teams.length === 0) {
    throw new Error('Linear workspace has no teams.');
  }
  return teams[0];
}

function runCli(args, env, cwd) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
    });
    const chunks = { stdout: [], stderr: [] };
    child.stdout.on('data', (b) => chunks.stdout.push(b));
    child.stderr.on('data', (b) => chunks.stderr.push(b));
    child.on('close', (code) => {
      resolveRun({
        code,
        stdout: Buffer.concat(chunks.stdout).toString('utf8'),
        stderr: Buffer.concat(chunks.stderr).toString('utf8'),
      });
    });
  });
}

async function main() {
  preflight();

  console.log('=== SPEX Linear Integration Sandbox ===');
  console.log(`Run id: ${RUN_ID}`);
  console.log('Endpoint: https://mcp.linear.app/mcp');

  header(1, 7, 'Connecting to Linear MCP');
  const linear = await createLinearMcpClient();
  check(`connected (endpoint=${linear.endpoint})`);

  try {
    header(2, 7, 'Discovering available MCP tools');
    const tools = await listTools(linear);
    check(`server advertises ${tools.length} tools`);
    note(`first 20: ${tools.slice(0, 20).join(', ')}${tools.length > 20 ? ', …' : ''}`);
    for (const expected of Object.values(LINEAR_TOOLS)) {
      if (tools.includes(expected)) {
        check(`tool "${expected}" present`);
      } else {
        warn(`tool "${expected}" NOT in advertised list — SPEX expected it`);
      }
    }
    const supportsCreateProject = tools.includes('create_project');
    if (!supportsCreateProject) {
      note('create_project is not advertised by this server — will skip project creation.');
    }

    header(3, 7, 'Listing teams');
    let teams;
    if (tools.includes('list_teams')) {
      const teamsResult = await callRawTool(linear, 'list_teams', {});
      teams = Array.isArray(teamsResult?.teams) ? teamsResult.teams : [];
    } else {
      warn('list_teams not advertised; will rely on SPEX_LINEAR_TEAM env var.');
      teams = [];
    }
    if (teams.length > 0) {
      for (const t of teams) {
        note(`- ${t.key ?? t.id}: ${t.name}`);
      }
    }
    const team = pickTeam(
      teams.length > 0
        ? teams
        : [
            {
              id: process.env.SPEX_LINEAR_TEAM,
              key: process.env.SPEX_LINEAR_TEAM,
              name: process.env.SPEX_LINEAR_TEAM,
            },
          ],
    );
    check(`using team: ${team.key ?? team.id} (${team.name})`);

    let projectInfo = null;
    if (supportsCreateProject) {
      header(4, 7, 'Creating sandbox project');
      try {
        projectInfo = await callRawTool(linear, 'create_project', {
          team: team.id ?? team.key,
          name: `SPEX Sandbox ${RUN_ID}`,
          description:
            'Automated sandbox run by scripts/linear-sandbox.mjs. Safe to archive after inspection.',
        });
        check(`project created: ${projectInfo?.name ?? '(unknown)'} ${projectInfo?.url ?? ''}`);
      } catch (err) {
        warn(`create_project failed: ${err.message}. Continuing without a project.`);
        projectInfo = null;
      }
    } else {
      header(4, 7, 'Skipping project creation (tool unavailable)');
    }

    header(5, 7, 'Creating issues');
    const issueTitlePrefix = `[Sandbox ${RUN_ID}]`;
    const issueA = await createLinearIssue({
      client: linear,
      team: team.key ?? team.id,
      title: `${issueTitlePrefix} Will go through opened → merged`,
      description:
        'Created by the SPEX sandbox. About to transition through the full PR-merged path.',
      labels: ['spex-sandbox'],
    });
    check(`${issueA.identifier}: ${issueA.title}`);
    note(`url: ${issueA.url}`);

    const issueB = await createLinearIssue({
      client: linear,
      team: team.key ?? team.id,
      title: `${issueTitlePrefix} Will go through opened → closed-unmerged`,
      description:
        'Created by the SPEX sandbox. Will demonstrate the rejected-PR rollback to Todo.',
      labels: ['spex-sandbox'],
    });
    check(`${issueB.identifier}: ${issueB.title}`);
    note(`url: ${issueB.url}`);

    const issueC = await createLinearIssue({
      client: linear,
      team: team.key ?? team.id,
      title: `${issueTitlePrefix} CLI flow control`,
      description: 'Created by the SPEX sandbox. Will be transitioned through the spex CLI binary.',
      labels: ['spex-sandbox'],
    });
    check(`${issueC.identifier}: ${issueC.title}`);
    note(`url: ${issueC.url}`);

    header(6, 7, 'Library-driven sync flow (syncPrEventToLinear)');

    console.log(`\n  ➤ ${issueA.identifier}: PR opened → In Review`);
    {
      const r = await syncPrEventToLinear({
        client: linear,
        linearId: issueA.identifier,
        event: {
          kind: 'opened',
          prNumber: 1001,
          prUrl: `https://github.com/rogcg/spex/pull/1001#sandbox-${RUN_ID}`,
        },
        statusMapping: STATUS_MAPPING,
      });
      check(`${r.issue.identifier} → ${r.issue.status}`);
    }
    await sleep(1500);

    console.log(`\n  ➤ ${issueA.identifier}: PR merged → Done`);
    {
      const r = await syncPrEventToLinear({
        client: linear,
        linearId: issueA.identifier,
        event: {
          kind: 'merged',
          prNumber: 1001,
          prUrl: `https://github.com/rogcg/spex/pull/1001#sandbox-${RUN_ID}`,
        },
        statusMapping: STATUS_MAPPING,
      });
      check(`${r.issue.identifier} → ${r.issue.status}`);
    }
    await sleep(1500);

    console.log(`\n  ➤ ${issueB.identifier}: PR opened → In Review`);
    await syncPrEventToLinear({
      client: linear,
      linearId: issueB.identifier,
      event: {
        kind: 'opened',
        prNumber: 1002,
        prUrl: `https://github.com/rogcg/spex/pull/1002#sandbox-${RUN_ID}`,
      },
      statusMapping: STATUS_MAPPING,
    });
    check(`${issueB.identifier} → In Review`);
    await sleep(1500);

    console.log(`\n  ➤ ${issueB.identifier}: PR closed without merge → Todo + auto-comment`);
    {
      const r = await syncPrEventToLinear({
        client: linear,
        linearId: issueB.identifier,
        event: {
          kind: 'closed_unmerged',
          prNumber: 1002,
          prUrl: `https://github.com/rogcg/spex/pull/1002#sandbox-${RUN_ID}`,
        },
        statusMapping: STATUS_MAPPING,
        commentOnUnmergedClose: true,
      });
      check(`${r.issue.identifier} → ${r.issue.status}`);
      if (r.comment) {
        check(`comment posted: ${r.comment.url}`);
      } else {
        warn('expected a comment but none was returned');
      }
    }
    await sleep(1500);

    console.log(`\n  ➤ ${issueA.identifier}: manual comment (addLinearComment)`);
    {
      const comment = await addLinearComment({
        client: linear,
        issueId: issueA.identifier,
        body: `SPEX sandbox run ${RUN_ID}: this issue completed the full opened → merged → Done lifecycle.`,
      });
      check(`comment posted: ${comment.url}`);
    }

    header(7, 7, 'CLI-driven sync flow (spex linear-sync via built binary)');
    const cliWorkDir = await mkdtemp(join(tmpdir(), 'spex-sandbox-cli-'));
    try {
      await writeFile(
        join(cliWorkDir, '.ai-config.yaml.tmp'),
        'placeholder so the directory has at least one file\n',
        'utf8',
      );
      // The CLI expects .ai/config.yaml in cwd, so set up a minimal one.
      const aiDir = join(cliWorkDir, '.ai');
      await writeFile(
        join(cliWorkDir, 'package.json'),
        JSON.stringify({ name: 'spex-sandbox', version: '0.0.0' }),
        'utf8',
      );
      await (await import('node:fs/promises')).mkdir(aiDir, { recursive: true });
      await writeFile(
        join(aiDir, 'config.yaml'),
        `integrations:\n  linear:\n    team: ${team.key ?? team.id}\n`,
        'utf8',
      );

      const eventPath = join(cliWorkDir, 'event.json');
      await writeFile(
        eventPath,
        JSON.stringify({
          action: 'opened',
          pull_request: {
            number: 1003,
            html_url: `https://github.com/rogcg/spex/pull/1003#sandbox-${RUN_ID}`,
            body: `Closes ${issueC.identifier}\n\nDriven by the spex linear-sync CLI.`,
            merged: false,
            head: { ref: `admin/${issueC.identifier.toLowerCase()}-cli-flow` },
          },
        }),
        'utf8',
      );

      console.log(`\n  ➤ spex linear-sync (event=opened) for ${issueC.identifier}`);
      const opened = await runCli(
        ['linear-sync', '--event-path', eventPath],
        { LINEAR_API_KEY: process.env.LINEAR_API_KEY },
        cliWorkDir,
      );
      console.log(
        opened.stdout
          .split('\n')
          .filter(Boolean)
          .map((l) => `    ${l}`)
          .join('\n'),
      );
      if (opened.code !== 0) {
        warn(`CLI exit ${opened.code}. stderr:\n${opened.stderr}`);
      }
      await sleep(1500);

      const mergedEventPath = join(cliWorkDir, 'event-merged.json');
      await writeFile(
        mergedEventPath,
        JSON.stringify({
          action: 'closed',
          pull_request: {
            number: 1003,
            html_url: `https://github.com/rogcg/spex/pull/1003#sandbox-${RUN_ID}`,
            body: `Closes ${issueC.identifier}`,
            merged: true,
            head: { ref: `admin/${issueC.identifier.toLowerCase()}-cli-flow` },
          },
        }),
        'utf8',
      );
      console.log(`\n  ➤ spex linear-sync (event=closed+merged) for ${issueC.identifier}`);
      const merged = await runCli(
        ['linear-sync', '--event-path', mergedEventPath],
        { LINEAR_API_KEY: process.env.LINEAR_API_KEY },
        cliWorkDir,
      );
      console.log(
        merged.stdout
          .split('\n')
          .filter(Boolean)
          .map((l) => `    ${l}`)
          .join('\n'),
      );
      if (merged.code !== 0) {
        warn(`CLI exit ${merged.code}. stderr:\n${merged.stderr}`);
      }
    } finally {
      if (process.env.SPEX_SANDBOX_KEEP !== '1') {
        await rm(cliWorkDir, { recursive: true, force: true });
      }
    }

    // Final read-back: confirm end states.
    console.log('\n=== Final state ===');
    for (const id of [issueA.identifier, issueB.identifier, issueC.identifier]) {
      try {
        const i = await getLinearIssue({ client: linear, id });
        console.log(`  ${i.identifier} → ${i.status}  (${i.url})`);
      } catch (err) {
        warn(`failed to read ${id}: ${err.message}`);
      }
    }
    if (projectInfo) {
      console.log(`  project: ${projectInfo.url ?? projectInfo.name}`);
    }

    console.log('\nInspect the Linear activity feed for the three issues above.');
    console.log(
      `Cleanup: delete the issues (and project if created) tagged with run id ${RUN_ID}.`,
    );
  } finally {
    await linear.close();
    await closeAllLinearMcpClients();
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error('\nSandbox failed:', err?.message ?? err);
  if (err?.stack) console.error(err.stack);
  process.exitCode = 1;
});
