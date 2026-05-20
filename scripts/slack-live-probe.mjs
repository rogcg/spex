#!/usr/bin/env node
import { createHmac, randomBytes } from 'node:crypto';
/**
 * Live Slack integration probe for SPX-60.
 *
 * This is NOT part of the CI / unit-test surface. It needs a real Slack app
 * + a real workspace + a real channel, and it makes outbound API calls. Run
 * it manually after install to validate the integration end-to-end.
 *
 * Required environment variables:
 *   SLACK_BOT_TOKEN          xoxb-... bot token from the installed app
 *   SLACK_SIGNING_SECRET     signing secret (used to sign the synthetic webhook delivery)
 *   SLACK_TEST_CHANNEL       channel id (C…) the bot is invited to
 *   SLACK_TOKEN_STORAGE_KEY  any random hex string (32+ chars), used by the token store probe
 *
 * What it exercises:
 *   1. Encrypted token store round-trip (no network)
 *   2. Block Kit template construction
 *   3. chat.postMessage to SLACK_TEST_CHANNEL (1 message per template)
 *   4. HMAC signature verification against a synthetic payload (no network)
 *   5. Approval record create + load + decision round-trip on a tmp project dir
 *
 * Exit codes:
 *   0   every probe passed
 *   1   at least one probe failed (details on stderr)
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const required = ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_TEST_CHANNEL'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required env var(s): ${missing.join(', ')}`);
  console.error('Set them and re-run. See scripts/slack-live-probe.mjs header for the full list.');
  process.exit(1);
}
if (!process.env.SLACK_TOKEN_STORAGE_KEY) {
  process.env.SLACK_TOKEN_STORAGE_KEY = randomBytes(32).toString('hex');
  console.error('(generated ephemeral SLACK_TOKEN_STORAGE_KEY for this probe)');
}

const slack = await import('../packages/integrations/slack/dist/index.js');
const {
  buildFixProposedTemplate,
  buildPrOpenedTemplate,
  buildReviewCompleteTemplate,
  buildSpecGeneratedTemplate,
  createPendingApproval,
  createSlackClient,
  loadApproval,
  loadWorkspaceTokens,
  notifyFixProposed,
  notifyPrOpened,
  notifyReviewComplete,
  notifySpecGenerated,
  recordDecision,
  saveWorkspaceTokens,
  verifySlackSignature,
} = slack;

const failures = [];

async function probe(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, error: err });
    console.error(`  ✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const tmpProject = await mkdtemp(join(tmpdir(), 'spex-slack-live-'));
const channelId = process.env.SLACK_TEST_CHANNEL;
const channels = { default: channelId };

console.log('\n=== SPEX Slack live probe ===\n');

await probe('encrypted token store round-trips', async () => {
  await saveWorkspaceTokens(
    {
      team: { id: 'T_PROBE', name: 'probe' },
      appId: 'A_PROBE',
      accessToken: process.env.SLACK_BOT_TOKEN,
      botUserId: 'B_PROBE',
      scope: 'chat:write',
      installedAt: new Date().toISOString(),
    },
    { projectDir: tmpProject },
  );
  const loaded = await loadWorkspaceTokens('T_PROBE', { projectDir: tmpProject });
  if (loaded?.accessToken !== process.env.SLACK_BOT_TOKEN) {
    throw new Error('round-trip mismatch');
  }
});

await probe('HMAC signature verification accepts a fresh signed body', () => {
  const body = 'hello=world';
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = `v0=${createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
    .update(`v0:${ts}:${body}`)
    .digest('hex')}`;
  const ok = verifySlackSignature({
    rawBody: body,
    signatureHeader: sig,
    timestampHeader: ts,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  });
  if (!ok) throw new Error('signature did not verify');
});

const client = createSlackClient();

await probe('chat.postMessage — pr_opened template', async () => {
  const result = await notifyPrOpened({
    client,
    channels,
    input: {
      branch: 'feature/slack-live-probe',
      title: 'SPEX live-probe: PR opened',
      prUrl: 'https://example.com/pr/1',
      repo: 'rogcg/spex',
      source: 'implement',
    },
  });
  if (result.kind !== 'sent') throw new Error(`expected sent, got ${result.kind}`);
});

await probe('chat.postMessage — fix_proposed template (with buttons)', async () => {
  const result = await notifyFixProposed({
    client,
    channels,
    input: {
      title: 'SPEX live-probe: fix proposed',
      hypothesis: 'A synthetic null-check missing in checkout/validate.ts.',
      filesAffected: ['src/checkout/validate.ts'],
      origin: 'live-probe (no real PostHog issue)',
      correlationId: 'spex-approval-live-probe',
    },
  });
  if (result.kind !== 'sent') throw new Error(`expected sent, got ${result.kind}`);
});

await probe('chat.postMessage — spec_generated template', async () => {
  const result = await notifySpecGenerated({
    client,
    channels,
    input: {
      title: 'SPEX live-probe: spec generated',
      slug: 'live-probe-spec',
      summary: 'A synthetic feature spec used only to validate the Slack template.',
      acceptanceCriteria: ['Validates Slack template rendering'],
    },
  });
  if (result.kind !== 'sent') throw new Error(`expected sent, got ${result.kind}`);
});

await probe('chat.postMessage — review_complete template', async () => {
  const result = await notifyReviewComplete({
    client,
    channels,
    input: {
      prNumber: 999,
      prTitle: 'SPEX live-probe: review complete',
      prUrl: 'https://example.com/pr/999',
      repo: 'rogcg/spex',
      verdict: 'approve',
      findingCount: 0,
      topFindings: [],
    },
  });
  if (result.kind !== 'sent') throw new Error(`expected sent, got ${result.kind}`);
});

await probe('approval record create + decision round-trip', async () => {
  const record = await createPendingApproval(
    {
      kind: 'fix_proposed',
      title: 'live-probe approval',
      payload: { source: 'live-probe' },
      config: { approvers: ['U_PROBE'], mode: 'any_of' },
      slack: { channelId, ts: '1.0' },
    },
    { projectDir: tmpProject },
  );
  const decision = await recordDecision({
    correlationId: record.correlationId,
    userId: 'U_PROBE',
    decision: 'approve',
    options: { projectDir: tmpProject },
  });
  if (decision.kind !== 'recorded' || decision.record.status !== 'approved') {
    throw new Error(
      `expected approved, got ${decision.kind}/${decision.kind === 'recorded' ? decision.record.status : '-'}`,
    );
  }
  const loaded = await loadApproval(record.correlationId, { projectDir: tmpProject });
  if (loaded?.status !== 'approved') throw new Error('approval did not persist as approved');
});

await rm(tmpProject, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\nLive probe failed: ${failures.length} probe(s) errored.`);
  process.exit(1);
}
console.log('\nAll live probes passed.\n');
