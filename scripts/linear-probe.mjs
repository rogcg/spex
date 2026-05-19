#!/usr/bin/env node
/**
 * Read-only probe of the real Linear MCP server. Lists tools (with their
 * input schemas) and dumps a representative response so we can correct
 * SPEX's hardcoded tool names / zod schemas before re-running the full
 * sandbox.
 *
 * Usage:
 *   LINEAR_API_KEY=<key> node scripts/linear-probe.mjs
 */

import {
  closeAllLinearMcpClients,
  createLinearMcpClient,
} from '../packages/integrations/linear/dist/index.js';

async function main() {
  if ((process.env.LINEAR_API_KEY ?? '').length === 0) {
    console.error('Error: LINEAR_API_KEY is not set.');
    process.exit(1);
  }

  const linear = await createLinearMcpClient();
  try {
    const { tools } = await linear.client.listTools();

    // Focus on the tools SPEX actually uses + adjacencies we may need.
    const focus = new Set([
      'get_issue',
      'list_issues',
      'save_issue',
      'save_comment',
      'list_teams',
      'get_team',
      'list_issue_statuses',
    ]);
    const relevant = tools
      .filter((t) => focus.has(t.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    console.log('=== Tool input schemas (relevant subset) ===');
    for (const t of relevant) {
      console.log(`\n--- ${t.name} ---`);
      console.log(`description: ${t.description ?? '(none)'}`);
      console.log('inputSchema:', JSON.stringify(t.inputSchema, null, 2));
    }

    console.log('\n\n=== Sample get_issue response (raw) ===');
    const sample = await linear.client.callTool({
      name: 'get_issue',
      arguments: { id: 'SPX-47' },
    });
    console.log('keys at top level:', Object.keys(sample));
    if (Array.isArray(sample.content)) {
      const text = sample.content.find((c) => c.type === 'text')?.text;
      if (typeof text === 'string') {
        console.log('content[0].text (parsed):');
        try {
          const parsed = JSON.parse(text);
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          console.log('(not JSON) →', text);
        }
      }
    }
    if (sample.structuredContent !== undefined) {
      console.log('structuredContent:');
      console.log(JSON.stringify(sample.structuredContent, null, 2));
    }
  } finally {
    await linear.close();
    await closeAllLinearMcpClients();
  }
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
