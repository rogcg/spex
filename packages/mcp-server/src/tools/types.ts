import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { LLMProvider, ScaffoldNextJsAppOptions } from '@spex/core';

/**
 * Optional dependency overrides for tests. Real invocations construct the
 * defaults from the environment (Anthropic key, real scaffold/git).
 *
 * All tools receive the same `ToolDependencies`; each tool consumes only the
 * fields it needs. This keeps the registry dispatcher simple at the cost of a
 * slightly wider deps surface than any one tool strictly requires.
 */
export interface ToolDependencies {
  llm?: LLMProvider;
  scaffold?: (options: ScaffoldNextJsAppOptions) => Promise<void>;
}

export interface ToolDefinition {
  tool: Tool;
  handle: (rawInput: unknown, deps: ToolDependencies) => Promise<CallToolResult>;
}

export function jsonTextResult(payload: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function errorResult(message: string, details?: Record<string, unknown>): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ status: 'error', message, ...details }, null, 2),
      },
    ],
    isError: true,
  };
}
