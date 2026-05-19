import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spexFixToolDefinition } from './spex-fix.js';
import { spexImplementToolDefinition } from './spex-implement.js';
import { spexNewToolDefinition } from './spex-new.js';
import { spexReviewToolDefinition } from './spex-review.js';
import { type ToolDefinition, type ToolDependencies, errorResult } from './types.js';

export const ALL_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  spexNewToolDefinition,
  spexImplementToolDefinition,
  spexFixToolDefinition,
  spexReviewToolDefinition,
];

/**
 * Register the SPEX tools on `server`. Replaces the stub `tools/list` handler
 * installed by `createSpexMcpServer` and adds a `tools/call` dispatcher.
 */
export function registerTools(server: Server, deps: ToolDependencies = {}): void {
  const byName = new Map(ALL_TOOL_DEFINITIONS.map((def) => [def.tool.name, def]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOL_DEFINITIONS.map((def) => def.tool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const definition = byName.get(name);
    if (!definition) {
      return errorResult(`Unknown tool: ${name}`, {
        available: ALL_TOOL_DEFINITIONS.map((def) => def.tool.name),
      });
    }
    return definition.handle(args ?? {}, deps);
  });
}
